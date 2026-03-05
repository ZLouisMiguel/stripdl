#!/usr/bin/env python3
# strip/cli.py

import json
import sys
import threading
from pathlib import Path
from typing import Optional

import click
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.live import Live
from rich.layout import Layout
from rich.text import Text
from rich.progress import (
    Progress, SpinnerColumn, BarColumn, TextColumn,
    TimeRemainingColumn, DownloadColumn, TransferSpeedColumn,
    TaskID
)
from rich import box
from rich.columns import Columns

from strip.config import config
from strip.parsers import get_parser
from strip.downloader import download_series, ChapterProgress
from strip.library import scan_library

console = Console()


# ────────────────────────────────────────────────────────────────────
#  Root group
# ────────────────────────────────────────────────────────────────────

@click.group()
@click.version_option("0.1.0", prog_name="stripdl")
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
@click.option("--concurrent-chapters", default=None, type=int,
              help="How many chapters to download at once (default: 3).")
def download(url: str, chapters: Optional[str], json_progress: bool,
             output: Optional[str], concurrent_chapters: Optional[int]):
    """Download a webtoon series from URL."""

    if output:
        config["download_dir"] = output
    if concurrent_chapters:
        config["concurrent_chapters"] = concurrent_chapters

    try:
        parser = get_parser(url)
    except ValueError as e:
        if json_progress:
            print(json.dumps({"status": "error", "message": str(e)}), flush=True)
        else:
            console.print(f"[red]Error:[/red] {e}")
        sys.exit(1)

    # Parse chapter filter
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
        download_series(
            parser=parser, url=url,
            chapter_range=chapter_range,
            specific_chapters=specific_chapters,
            json_progress=True,
        )
        return

    # ── Interactive Rich CLI mode ────────────────────────────────────
    console.print(Panel.fit(
        f"[bold cyan]stripdl[/bold cyan] – [dim]{url}[/dim]",
        border_style="cyan"
    ))

    # One Progress bar per active chapter, tracked by chapter number
    progress = Progress(
        SpinnerColumn(),
        TextColumn("[bold]{task.description}"),
        BarColumn(bar_width=30),
        TextColumn("[cyan]{task.completed}[/cyan]/[white]{task.total}[/white] pages"),
        TextColumn("[dim]{task.fields[status]}[/dim]"),
        console=console,
        transient=False,
    )

    # Overall task
    overall_task: Optional[TaskID] = None
    chapter_tasks: dict[float, TaskID] = {}
    lock = threading.Lock()
    series_title = [url]   # mutable box

    def on_progress(cp: ChapterProgress):
        with lock:
            if cp.status == "skipped":
                # Show a brief skipped line but don't add a bar
                if cp.chapter_number not in chapter_tasks:
                    t = progress.add_task(
                        f"Ch {int(cp.chapter_number):>4}  {cp.chapter_title[:40]}",
                        total=cp.pages_total,
                        completed=cp.pages_total,
                        status="[dim]skipped[/dim]",
                    )
                    chapter_tasks[cp.chapter_number] = t
                return

            if cp.chapter_number not in chapter_tasks:
                t = progress.add_task(
                    f"Ch {int(cp.chapter_number):>4}  {cp.chapter_title[:40]}",
                    total=cp.pages_total if cp.pages_total else 1,
                    completed=0,
                    status="",
                )
                chapter_tasks[cp.chapter_number] = t
            else:
                t = chapter_tasks[cp.chapter_number]

            if cp.status == "done":
                progress.update(t,
                    completed=cp.pages_total,
                    status="[green]✓ done[/green]")
                # Update overall
                if overall_task is not None:
                    progress.advance(overall_task, 1)
            elif cp.status == "error":
                progress.update(t, status="[red]✗ error[/red]")
            else:
                progress.update(t,
                    completed=cp.pages_done,
                    total=cp.pages_total,
                    status=f"[dim]{cp.pages_done}/{cp.pages_total}[/dim]")

    with progress:
        # We don't know total chapters yet — add overall after fetch
        fetch_task = progress.add_task("Fetching series info…", total=None, status="")

        # Monkey-patch: capture series info from downloader output
        original_emit = None
        total_chapters_known = [False]

        def _intercept_cb(cp: ChapterProgress):
            on_progress(cp)

        try:
            # First, get series info & chapter count separately so we can
            # set up the overall bar before downloads start
            with console.status("[cyan]Fetching series info…[/cyan]", spinner="dots"):
                series_info = parser.get_series_info(url)
                series_title[0] = series_info.title

            progress.update(fetch_task,
                description=f"[bold]{series_info.title}[/bold] by {series_info.author}",
                total=1, completed=1, status="")

            with console.status("[cyan]Fetching chapter list…[/cyan]", spinner="dots"):
                all_chapters = parser.get_chapter_list(url)

            # Filter
            if specific_chapters:
                to_dl = [c for c in all_chapters if int(c.number) in specific_chapters]
            elif chapter_range:
                s, e = chapter_range
                to_dl = [c for c in all_chapters if s <= c.number <= e]
            else:
                to_dl = all_chapters

            console.print(
                f"  [cyan]◈[/cyan] [bold]{series_info.title}[/bold]  "
                f"[dim]{series_info.author}[/dim]\n"
                f"  [dim]{len(all_chapters)} chapters found · "
                f"{len(to_dl)} to download · "
                f"saving to {config.download_dir}[/dim]\n"
            )

            nonlocal_overall = progress.add_task(
                "[bold white]Overall",
                total=len(to_dl),
                completed=0,
                status="",
            )
            # make available to callback
            import ctypes
            overall_task_holder = [nonlocal_overall]

            def _cb(cp: ChapterProgress):
                nonlocal overall_task
                overall_task = overall_task_holder[0]
                on_progress(cp)

            series_dir = download_series(
                parser=parser,
                url=url,
                chapter_range=chapter_range,
                specific_chapters=specific_chapters,
                json_progress=False,
                progress_cb=_cb,
            )

        except Exception as e:
            console.print(f"\n[red]Download failed:[/red] {e}")
            sys.exit(1)

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