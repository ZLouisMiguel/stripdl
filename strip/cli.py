#!/usr/bin/env python3
# strip/cli.py

import json
import sys
import threading
import time
from pathlib import Path
from typing import Optional

import click
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.progress import (
    Progress, SpinnerColumn, BarColumn, TextColumn,
    TaskID,
)
from rich import box

from strip.config import config
from strip.parsers import get_parser
from strip.downloader import download_series, ChapterProgress
from strip.library import scan_library

console = Console()

_VERSION = "0.2.0"


# ────────────────────────────────────────────────────────────────────
#  Root group
# ────────────────────────────────────────────────────────────────────

@click.group()
@click.version_option(_VERSION, prog_name="stripdl")
def cli():
    """
    \b
    ███████╗████████╗██████╗ ██╗██████╗
    ██╔════╝╚══██╔══╝██╔══██╗██║██╔══██╗
    ███████╗   ██║   ██████╔╝██║██████╔╝
    ╚════██║   ██║   ██╔══██╗██║██╔═══╝
    ███████║   ██║   ██║  ██║██║██║
    ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝╚═╝

    Webtoon downloader & library manager.
    """
    pass


# ────────────────────────────────────────────────────────────────────
#  Watchdog: detects frozen progress
# ────────────────────────────────────────────────────────────────────

class _ProgressWatchdog:
    """
    Background daemon thread. If no progress update arrives for stall_secs,
    marks every active task as 'waiting…' so the user knows it isn't frozen.
    Clears automatically when progress resumes.
    """

    def __init__(self, progress: Progress, stall_secs: float = 20.0):
        self._progress = progress
        self._stall_secs = stall_secs
        self._last_update = time.monotonic()
        self._task_map: dict[float, TaskID] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop.set()

    def ping(self):
        with self._lock:
            self._last_update = time.monotonic()

    def register(self, chapter_number: float, task_id: TaskID):
        with self._lock:
            self._task_map[chapter_number] = task_id

    def unregister(self, chapter_number: float):
        with self._lock:
            self._task_map.pop(chapter_number, None)

    def _run(self):
        stalled = False
        while not self._stop.wait(timeout=2.0):
            with self._lock:
                age = time.monotonic() - self._last_update
                task_ids = list(self._task_map.values())

            if age > self._stall_secs and task_ids and not stalled:
                stalled = True
                for tid in task_ids:
                    try:
                        self._progress.update(tid, status="[yellow]waiting…[/yellow]")
                    except Exception:
                        pass
            elif age <= self._stall_secs and stalled:
                stalled = False


# ────────────────────────────────────────────────────────────────────
#  download
# ────────────────────────────────────────────────────────────────────

@cli.command()
@click.argument("url")
@click.option("--chapters", "-c",
              help="Chapters to download: range '1-20' or list '1,3,5'.")
@click.option("--json-progress", is_flag=True, hidden=True,
              help="Emit JSON progress lines (Electron subprocess mode).")
@click.option("--output", "-o", type=click.Path(),
              help="Override download directory for this run.")
@click.option("--concurrent-downloads", default=None, type=int,
              help="Concurrent image downloads per chapter (default: 4).")
@click.option("--chapter-delay", default=None, type=float,
              help="Seconds to wait between chapters (default: 1.5).")
def download(
    url: str,
    chapters: Optional[str],
    json_progress: bool,
    output: Optional[str],
    concurrent_downloads: Optional[int],
    chapter_delay: Optional[float],
):
    """Download a webtoon series from URL.

    Resumes automatically from where it left off — already-completed
    chapters are skipped. Two terminals cannot download the same series
    at the same time (a lock file prevents it).
    """

    if output:
        config["download_dir"] = output
    if concurrent_downloads:
        config["concurrent_downloads"] = concurrent_downloads
    if chapter_delay is not None:
        config["chapter_delay"] = chapter_delay

    try:
        parser = get_parser(url)
    except ValueError as e:
        if json_progress:
            print(json.dumps({"status": "error", "message": str(e)}), flush=True)
        else:
            console.print(f"[red]Error:[/red] {e}")
        sys.exit(1)

    chapter_range = None
    specific_chapters = None
    if chapters:
        if "-" in chapters and "," not in chapters:
            parts = chapters.split("-")
            try:
                chapter_range = (float(parts[0]), float(parts[1]))
            except ValueError:
                console.print("[red]Invalid range. Use e.g. 1-10[/red]")
                sys.exit(1)
        else:
            try:
                specific_chapters = [int(x.strip()) for x in chapters.split(",")]
            except ValueError:
                console.print("[red]Invalid chapter list. Use e.g. 1,2,5[/red]")
                sys.exit(1)

    # ── Electron / JSON mode ─────────────────────────────────────────
    if json_progress:
        try:
            download_series(
                parser=parser, url=url,
                chapter_range=chapter_range,
                specific_chapters=specific_chapters,
                json_progress=True,
            )
        except RuntimeError as e:
            print(json.dumps({"status": "error", "message": str(e)}), flush=True)
            sys.exit(1)
        return

    # ── Interactive Rich CLI mode ────────────────────────────────────
    console.print(Panel.fit(
        f"[bold cyan]stripdl[/bold cyan] – [dim]{url}[/dim]",
        border_style="cyan",
    ))

    progress = Progress(
        SpinnerColumn(),
        TextColumn("[bold]{task.description:<50}"),
        BarColumn(bar_width=28),
        TextColumn("[cyan]{task.completed}[/cyan]/[white]{task.total}[/white]"),
        TextColumn(" {task.fields[status]}"),
        console=console,
        transient=False,
    )

    chapter_tasks: dict[float, TaskID] = {}
    overall_task: list[Optional[TaskID]] = [None]
    lock = threading.Lock()
    watchdog = _ProgressWatchdog(progress, stall_secs=20.0)

    def on_progress(cp: ChapterProgress):
        watchdog.ping()
        with lock:
            ch = cp.chapter_number
            label = f"Ch {int(ch):>4}  {cp.chapter_title[:38]}"

            if cp.status == "skipped":
                if ch not in chapter_tasks:
                    tid = progress.add_task(
                        label,
                        total=max(cp.pages_total, 1),
                        completed=cp.pages_total,
                        status="[dim]skipped[/dim]",
                    )
                    chapter_tasks[ch] = tid
                return

            if cp.status.startswith("rate_limited:"):
                secs = cp.status.split(":")[1]
                if ch in chapter_tasks:
                    progress.update(
                        chapter_tasks[ch],
                        status=f"[yellow]rate-limited – waiting {secs}s[/yellow]",
                    )
                return

            if ch not in chapter_tasks:
                tid = progress.add_task(
                    label,
                    total=max(cp.pages_total, 1),
                    completed=0,
                    status="",
                )
                chapter_tasks[ch] = tid
                watchdog.register(ch, tid)

            tid = chapter_tasks[ch]

            if cp.status == "done":
                progress.update(
                    tid,
                    completed=cp.pages_total,
                    status="[green]✓ done[/green]",
                )
                watchdog.unregister(ch)
                if overall_task[0] is not None:
                    progress.advance(overall_task[0], 1)

            elif cp.status == "error":
                progress.update(tid, status="[red]✗ error[/red]")
                watchdog.unregister(ch)

            else:
                progress.update(
                    tid,
                    completed=cp.pages_done,
                    total=max(cp.pages_total, 1),
                    status=f"[dim]{cp.pages_done}/{cp.pages_total}[/dim]",
                )

    with progress:
        watchdog.start()
        fetch_task = progress.add_task(
            "Fetching series info…", total=1, completed=0, status="")

        try:
            with console.status("[cyan]Fetching series info…[/cyan]", spinner="dots"):
                series_info = parser.get_series_info(url)

            progress.update(
                fetch_task,
                description=f"[bold]{series_info.title}[/bold] by {series_info.author}",
                completed=1,
                status="",
            )

            with console.status("[cyan]Fetching chapter list…[/cyan]", spinner="dots"):
                all_chapters = parser.get_chapter_list(url)

            if specific_chapters:
                to_dl = [c for c in all_chapters if int(c.number) in specific_chapters]
            elif chapter_range:
                s, e = chapter_range
                to_dl = [c for c in all_chapters if s <= c.number <= e]
            else:
                to_dl = all_chapters

            console.print(
                f"\n  [cyan]◈[/cyan] [bold]{series_info.title}[/bold]  "
                f"[dim]{series_info.author}[/dim]\n"
                f"  [dim]{len(all_chapters)} chapters found · "
                f"{len(to_dl)} queued · "
                f"saving to {config.download_dir}[/dim]\n"
            )

            overall_tid = progress.add_task(
                "[bold white]Overall",
                total=len(to_dl),
                completed=0,
                status="",
            )
            overall_task[0] = overall_tid

            series_dir = download_series(
                parser=parser,
                url=url,
                chapter_range=chapter_range,
                specific_chapters=specific_chapters,
                json_progress=False,
                progress_cb=on_progress,
            )

        except RuntimeError as e:
            console.print(f"\n[red bold]✗ {e}[/red bold]")
            watchdog.stop()
            sys.exit(1)
        except Exception as e:
            console.print(f"\n[red]Download failed:[/red] {e}")
            watchdog.stop()
            sys.exit(1)

        watchdog.stop()

    console.print(f"\n[bold green]✓ Done![/bold green]  {series_dir}\n")


# ────────────────────────────────────────────────────────────────────
#  list
# ────────────────────────────────────────────────────────────────────

@cli.command(name="list")
@click.argument("url")
def list_chapters(url: str):
    """List all available chapters for a webtoon URL."""
    try:
        parser = get_parser(url)
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        sys.exit(1)

    with console.status("Fetching series info…"):
        info = parser.get_series_info(url)
    with console.status("Fetching chapter list…"):
        chapters = parser.get_chapter_list(url)

    console.print(Panel(
        f"[bold]{info.title}[/bold]\n"
        f"[dim]Author:[/dim] {info.author}\n"
        f"[dim]Status:[/dim] {info.status or 'unknown'}\n"
        f"[dim]Genre:[/dim]  {info.genre or '—'}",
        title="Series Info", border_style="cyan",
    ))

    table = Table(box=box.SIMPLE_HEAD, show_edge=False)
    table.add_column("#", style="cyan", width=6, justify="right")
    table.add_column("Title")
    table.add_column("Date", style="dim", width=12)

    for ch in chapters:
        table.add_row(str(int(ch.number)), ch.title, ch.date)

    console.print(table)
    console.print(f"\n[dim]Total: {len(chapters)} chapters[/dim]")


# ────────────────────────────────────────────────────────────────────
#  library
# ────────────────────────────────────────────────────────────────────

@cli.command()
def library():
    """Show all locally downloaded series."""
    series_list = scan_library()

    if not series_list:
        console.print(
            f"[yellow]Library is empty.[/yellow]\n"
            f"Download something: [bold]stripdl download <url>[/bold]\n"
            f"Library location:   {config.download_dir}"
        )
        return

    table = Table(title="Local Library", box=box.ROUNDED, show_edge=True)
    table.add_column("Title", style="bold")
    table.add_column("Author", style="dim")
    table.add_column("Chapters", justify="right", style="cyan")
    table.add_column("Location", style="dim")

    for s in series_list:
        table.add_row(s.title, s.author or "—", str(s.chapter_count), str(s.directory))

    console.print(table)


# ────────────────────────────────────────────────────────────────────
#  config
# ────────────────────────────────────────────────────────────────────

@cli.command(name="config")
@click.option("--set", "set_kv", metavar="KEY=VALUE", help="Set a config value.")
@click.option("--get", "get_key", metavar="KEY", help="Get a config value.")
@click.option("--reset", is_flag=True, help="Reset config to defaults.")
def config_cmd(set_kv: Optional[str], get_key: Optional[str], reset: bool):
    """View or edit stripdl configuration."""

    if reset:
        import copy
        from strip.config import _DEFAULTS
        config._data = copy.deepcopy(_DEFAULTS)
        config.save()
        console.print("[green]Config reset to defaults.[/green]")
        return

    if set_kv:
        if "=" not in set_kv:
            console.print("[red]Use KEY=VALUE format[/red]")
            sys.exit(1)
        k, v = set_kv.split("=", 1)
        for cast in (int, float):
            try:
                v = cast(v); break
            except ValueError:
                pass
        if v in ("true", "True"): v = True
        elif v in ("false", "False"): v = False
        config[k] = v
        config.save()
        console.print(f"[green]Set[/green] {k} = {v}")
        return

    if get_key:
        val = config.get(get_key)
        console.print(f"{get_key} = {val}" if val is not None
                      else f"[yellow]Key '{get_key}' not found[/yellow]")
        return

    table = Table(title="stripdl Configuration", box=box.SIMPLE)
    table.add_column("Key", style="bold cyan")
    table.add_column("Value")
    for k, v in sorted(config.all().items()):
        table.add_row(k, str(v))
    console.print(table)


# ────────────────────────────────────────────────────────────────────
#  Entry point
# ────────────────────────────────────────────────────────────────────

def main():
    cli()

if __name__ == "__main__":
    main()