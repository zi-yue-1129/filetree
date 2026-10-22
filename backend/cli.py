"""
CLI management tool for the FileTree system.

Uses the backend services for consistent data management.
"""

import asyncio
import click
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


@cli.command('recover-uploads')
@click.option('--dry-run', is_flag=True, help='Only list the uploads that would be imported.')
@async_command
async def recover_uploads(dry_run: bool) -> None:
    """Import finished uploads that were left in tus_temp and never listed.

    Args:
        dry_run: Only list the uploads that would be imported.
    """
    from backend.routes.tus import metadata_store, recover_stranded_uploads
    from backend.services.database import close_all, init_db

    await init_db()
    try:
        upload_ids = await recover_stranded_uploads(dry_run)
    finally:
        await close_all()
    for upload_id in upload_ids:
        upload = metadata_store.get_upload(upload_id)
        owner = upload['username'] if upload else '?'
        name = upload['filename'] if upload else '?'
        click.echo(f'{"[PLAN]" if dry_run else "[OK]"} {owner}: {name} ({upload_id})')
    click.echo(f'{"Would import" if dry_run else "Imported"} {len(upload_ids)} upload(s).')


if __name__ == '__main__':
    cli()
