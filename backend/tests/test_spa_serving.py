"""Tests for the SPA catch-all route in ``backend.app``."""

from fastapi.testclient import TestClient

from backend.tests.conftest import SECRET_FILE


def test_serves_existing_static_asset(client: TestClient) -> None:
    """A file inside the static directory is returned as-is."""
    response = client.get("/app.js")
    assert response.status_code == 200
    assert response.text == "console.log('ok');"


def test_unknown_path_falls_back_to_index(client: TestClient) -> None:
    """Unknown client-side routes receive index.html for SPA routing."""
    response = client.get("/some/client/route")
    assert response.status_code == 200
    assert "<title>SPA</title>" in response.text


def test_dot_dot_segments_cannot_escape_static_dir(client: TestClient) -> None:
    """Encoded ``..`` segments must not read files outside the static dir."""
    response = client.get(f"/..%2F{SECRET_FILE.name}")
    assert "TOP-SECRET" not in response.text
    assert "<title>SPA</title>" in response.text


def test_absolute_path_cannot_escape_static_dir(client: TestClient) -> None:
    """An encoded absolute path must not be joined onto the static dir."""
    response = client.get(f"/%2F{str(SECRET_FILE).lstrip('/')}")
    assert "TOP-SECRET" not in response.text
    assert "<title>SPA</title>" in response.text
