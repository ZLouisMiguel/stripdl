#!/usr/bin/env python3
# strip/cli.py
# Main command-line interface for strip.
# Uses Click for argument parsing and Rich for beautiful terminal output.

import json
import subprocess
import sys
from pathlib import Path
from typing import Optional

import click
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich import box
from rich.progress import (
    Progress, SpinnerColumn, BarColumn, TextColumn,
    TimeRemainingColumn, MofNCompleteColumn
)

from strip.config import config
from strip.parsers import get_parser
from strip.downloader import download_series
from strip.library import scan_library

console = Console()


# ────────────────────────────────────────────────────────────────────
#  Root group
# ────────────────────────────────────────────────────────────────────

@click.group()
@click.version_option("0.1.0", prog_name="strip")
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
@click.option(
    "--chapters", "-c",
    help="Specific chapters to download (e.g. '1,2,5' or '1-10').",
)
@click.option(
    "--json-progress", is_flag=True, hidden=True,
    help="Emit JSON progress lines (used by Electron app).",
)
@click.option(
    "--output", "-o",
    type=click.Path(),
    help="Override download directory for this run.",
)
def download(url: str, chapters: Optional[str], json_progress: bool, output: Optional[str]):
    """Download a webtoon series from URL."""

    if output:
        config["download_dir"] = output

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
                console.print("[red]Invalid chapter range format. Use e.g. 1-10[/red]")
                sys.exit(1)
        else:
            try:
                specific_chapters = [int(x.strip()) for x in chapters.split(",")]
            except ValueError:
                console.print("[red]Invalid chapter list. Use e.g. 1,2,5[/red]")
                sys.exit(1)

    if json_progress:
        # Electron mode: emit raw JSON, no rich output
        download_series(
            parser=parser,
            url=url,
            chapter_range=chapter_range,
            specific_chapters=specific_chapters,
            json_progress=True,
        )
        return

    # ---- Interactive rich output
    console.print(
        Panel.fit(f"[bold cyan]strip[/bold cyan] – downloading from [underline]{url}[/underline]")
    )

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        TimeRemainingColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Fetching series info…", total=None)

        def on_progress(done: int, total: int):
            progress.update(task, completed=done, total=total)

        try:
            series_dir = download_series(
                parser=parser,
                url=url,
                chapter_range=chapter_range,
                specific_chapters=specific_chapters,
                json_progress=False,
                console=console,
            )
            progress.update(task, description="[green]Done!", completed=1, total=1)
        except Exception as e:
            console.print(f"\n[red]Download failed:[/red] {e}")
            sys.exit(1)

    console.print(f"\n[bold green]✓ Downloaded to:[/bold green] {series_dir}")


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

    with console.status("Fetching chapter list…"):
        try:
            info = parser.get_series_info(url)
            chapters = parser.get_chapter_list(url)
        except Exception as e:
            console.print(f"[red]Error:[/red] {e}")
            sys.exit(1)

    console.print(Panel(
        f"[bold]{info.title}[/bold]\n"
        f"Author: {info.author}\n"
        f"Status: {info.status or 'unknown'}",
        title="Series Info",
        border_style="cyan",
    ))

    table = Table(box=box.SIMPLE_HEAD)
    table.add_column("#", style="dim", width=6)
    table.add_column("Title")
    table.add_column("Date", style="dim")

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
            f"Download something with: [bold]strip download <url>[/bold]\n"
            f"Library location: {config.download_dir}"
        )
        return

    table = Table(title="Local Library", box=box.ROUNDED)
    table.add_column("Title", style="bold")
    table.add_column("Author", style="dim")
    table.add_column("Chapters", justify="right")
    table.add_column("Location", style="dim")

    for s in series_list:
        table.add_row(
            s.title,
            s.author or "—",
            str(s.chapter_count),
            str(s.directory),
        )

    console.print(table)


# ────────────────────────────────────────────────────────────────────
#  config
# ────────────────────────────────────────────────────────────────────

@cli.command(name="config")
@click.option("--set", "set_kv", metavar="KEY=VALUE", help="Set a config value.")
@click.option("--get", "get_key", metavar="KEY", help="Get a config value.")
@click.option("--reset", is_flag=True, help="Reset config to defaults.")
def config_cmd(set_kv: Optional[str], get_key: Optional[str], reset: bool):
    """View or edit strip configuration."""

    if reset:
        from strip.config import _CONFIG_FILE, _DEFAULTS
        import copy
        config._data = copy.deepcopy(_DEFAULTS)
        config.save()
        console.print("[green]Config reset to defaults.[/green]")
        return

    if set_kv:
        if "=" not in set_kv:
            console.print("[red]Use KEY=VALUE format[/red]")
            sys.exit(1)
        k, v = set_kv.split("=", 1)
        # Try to cast to int/float/bool
        for cast in (int, float):
            try:
                v = cast(v)
                break
            except ValueError:
                pass
        if v in ("true", "True"):
            v = True
        elif v in ("false", "False"):
            v = False
        config[k] = v
        config.save()
        console.print(f"[green]Set[/green] {k} = {v}")
        return

    if get_key:
        val = config.get(get_key)
        if val is None:
            console.print(f"[yellow]Key '{get_key}' not found[/yellow]")
        else:
            console.print(f"{get_key} = {val}")
        return

    # Show all
    table = Table(title="strip Configuration", box=box.SIMPLE)
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
