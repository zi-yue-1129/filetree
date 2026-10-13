"""
CLI management tool for the FileTree system.

Uses the backend services for consistent data management.
"""

import asyncio
import click
from pathlib import Path
import json
from backend.services.user_service import UserService
from backend.core.auth import generate_salt, hash_password
from backend.config import settings

import functools

# Create a sync wrapper for the CLI
def async_command(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        return asyncio.run(f(*args, **kwargs))
    return wrapper


@click.group()
def cli():
    """FileTree CLI Management Tool."""
    pass


@cli.command()
@click.option('--name', '-n', required=True, help='Username')
@click.option('--password', '-p', help='Password (defaults to username)')
@click.option('--folder', '-f', help='Folder name (defaults to username)')
@async_command
async def createuser(name, password, folder):
    """Create a new user."""
    svc = UserService()
    users = await svc._read_users()
    
    if any(u['username'] == name for u in users):
        click.echo(f'[ERROR] User "{name}" already exists.')
        return

    password = password or name
    salt = generate_salt()
    
    new_user = {
        'username': name,
        'folder': folder or name,
        'salt': salt,
        'hashed_password': hash_password(password, salt),
        'first_login': True,
        'is_locked': False,
        'urls': []
    }
    
    users.append(new_user)
    await svc._write_users(users)
    
    # Create folder
    path = settings.paths.upload_folder / new_user['folder']
    path.mkdir(parents=True, exist_ok=True)
    
    click.echo(f'[OK] User "{name}" created successfully!')


@cli.command()
@async_command
async def listusers():
    """List all users."""
    svc = UserService()
    users = await svc._read_users()
    
    if not users:
        click.echo('[INFO] No users found.')
        return
        
    for i, user in enumerate(users, 1):
        click.echo(f'{i}. {user["username"]} (Folder: {user["folder"]})')


@cli.command()
def backup() -> None:
    """Back up all databases now (same format and retention as the scheduler)."""
    from backend.services.backup_service import create_backup, default_sources

    set_dir = create_backup(default_sources(), settings.backup.dir, settings.backup.keep)
    click.echo(f'[OK] Backup written to {set_dir}')


if __name__ == '__main__':
    cli()
