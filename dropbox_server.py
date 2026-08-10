"""
Dropbox upload backend for CodeSnipper.
Experiment 4: Storage as a Service with Dropbox API.

This Flask server receives code snippets from the CodeSnipper frontend
and uploads them to Dropbox using the official Dropbox Python SDK.
"""

import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import dropbox
from dropbox.files import WriteMode
from werkzeug.utils import secure_filename

# Load environment variables from .env
load_dotenv()

app = Flask(__name__)
CORS(app)

# Read the Dropbox access token from environment
ACCESS_TOKEN = os.getenv("DROPBOX_ACCESS_TOKEN")

# Language extension mapping
LANGUAGE_EXTENSIONS = {
    "python": ".py",
    "javascript": ".js",
    "typescript": ".ts",
    "java": ".java",
    "c": ".c",
    "cpp": ".cpp",
    "c++": ".cpp",
    "csharp": ".cs",
    "c#": ".cs",
    "go": ".go",
    "rust": ".rs",
    "ruby": ".rb",
    "php": ".php",
    "swift": ".swift",
    "kotlin": ".kt",
    "html": ".html",
    "css": ".css",
    "sql": ".sql",
    "shell": ".sh",
    "bash": ".sh",
    "r": ".r",
    "dart": ".dart",
    "lua": ".lua",
    "perl": ".pl",
    "scala": ".scala",
    "text": ".txt",
}


def get_dropbox_token():
    """Reload dotenv and return the latest token from environment."""
    load_dotenv()
    return os.getenv("DROPBOX_ACCESS_TOKEN")


def get_dropbox_client():
    """Create and return a Dropbox client. Raises an error if the token is missing."""
    token = get_dropbox_token()
    if not token or token == "YOUR_DROPBOX_ACCESS_TOKEN_HERE":
        raise ValueError(
            "DROPBOX_ACCESS_TOKEN is not configured or still has placeholder. "
            "Please update DROPBOX_ACCESS_TOKEN in the .env file."
        )
    return dropbox.Dropbox(token)


def build_filename(title, language):
    """Build a safe filename from the snippet title and language."""
    # Clean the title to make a safe filename
    safe_title = secure_filename(title) if title else "snippet"
    if not safe_title:
        safe_title = "snippet"

    # Remove any existing extension from the title
    name_without_ext = os.path.splitext(safe_title)[0]

    # Get the correct file extension for the language
    ext = LANGUAGE_EXTENSIONS.get(language.lower(), ".txt") if language else ".txt"

    return f"{name_without_ext}{ext}"


@app.route("/api/dropbox/upload", methods=["POST"])
def upload_to_dropbox():
    """
    Upload a code snippet to Dropbox.

    Accepts JSON body:
    {
        "title": "my_script",
        "code": "print('hello world')",
        "language": "python"
    }

    Uploads the code as a file to /CodeSnipper/<filename> in Dropbox.
    """

    # --- Validate Dropbox token ---
    token = get_dropbox_token()
    if not token or token == "YOUR_DROPBOX_ACCESS_TOKEN_HERE":
        return jsonify({
            "error": "Dropbox is not configured. Set DROPBOX_ACCESS_TOKEN in .env."
        }), 503

    # --- Parse request ---
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data provided. Send JSON with title, code, and language."}), 400

    title = (data.get("title") or "").strip()
    code = (data.get("code") or "").strip()
    language = (data.get("language") or "text").strip()

    # --- Validate fields ---
    if not title:
        return jsonify({"error": "Title/filename is required."}), 400

    if not code:
        return jsonify({"error": "Code content is required."}), 400

    # --- Build the filename and Dropbox path ---
    filename = build_filename(title, language)
    dropbox_path = f"/CodeSnipper/{filename}"

    # --- Upload to Dropbox ---
    try:
        dbx = get_dropbox_client()

        # Convert code string to bytes for upload
        file_bytes = code.encode("utf-8")

        dbx.files_upload(
            file_bytes,
            dropbox_path,
            mode=WriteMode.overwrite,
        )

        return jsonify({
            "message": "File uploaded to Dropbox successfully!",
            "filename": filename,
            "dropbox_path": dropbox_path,
        }), 200

    except dropbox.exceptions.AuthError as e:
        print("Dropbox AuthError during upload:", e)
        return jsonify({
            "error": f"Dropbox authentication failed: {str(e)}"
        }), 401

    except dropbox.exceptions.ApiError as e:
        print("Dropbox ApiError during upload:", e)
        return jsonify({
            "error": f"Dropbox API error: {str(e)}"
        }), 500

    except ValueError as e:
        print("ValueError during upload:", e)
        return jsonify({"error": str(e)}), 503

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            "error": f"Upload failed: {str(e)}"
        }), 500


@app.route("/api/dropbox/health", methods=["GET"])
def dropbox_health():
    """Check if Dropbox is configured and reachable."""
    token = get_dropbox_token()
    if not token or token == "YOUR_DROPBOX_ACCESS_TOKEN_HERE":
        return jsonify({
            "ok": False,
            "error": "DROPBOX_ACCESS_TOKEN is not set.",
        }), 503

    try:
        dbx = get_dropbox_client()
        account = dbx.users_get_current_account()
        return jsonify({
            "ok": True,
            "account": account.name.display_name,
        }), 200
    except Exception as e:
        return jsonify({
            "ok": False,
            "error": str(e),
        }), 500


if __name__ == "__main__":
    print("=" * 50)
    print("  CodeSnipper Dropbox Backend")
    print("  Experiment 4: Storage as a Service")
    print("=" * 50)

    if ACCESS_TOKEN:
        print("  Dropbox token: configured")
    else:
        print("  WARNING: DROPBOX_ACCESS_TOKEN not set in .env")

    print(f"  Server starting on http://localhost:5001")
    print("=" * 50)

    app.run(host="0.0.0.0", port=5001, debug=True)
