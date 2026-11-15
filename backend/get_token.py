"""
Get a login token for testing the API on http://127.0.0.1:8000/docs

    python get_token.py

Sign in with a Firebase email and password. Copy the token it prints, click
"Authorize" on the /docs page, and paste it. Tokens last one hour.

(The real front end gets this token by itself when someone logs in.)
"""
import json
import sys
import urllib.error
import urllib.request

from app import config


def main() -> None:
    if not config.FIREBASE_WEB_API_KEY or config.FIREBASE_WEB_API_KEY.startswith("paste-"):
        sys.exit("Set FIREBASE_WEB_API_KEY in the .env file first (the apiKey from your firebaseConfig).")

    email = input("Email: ").strip()
    password = input("Password: ").strip()
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={config.FIREBASE_WEB_API_KEY}"
    body = json.dumps({"email": email, "password": password, "returnSecureToken": True}).encode()
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request) as response:
            token = json.load(response)["idToken"]
    except urllib.error.HTTPError as error:
        reason = json.load(error).get("error", {}).get("message", "unknown error")
        sys.exit(f"Sign-in failed: {reason}")

    print("\nYour token (valid for 1 hour). Paste it into Authorize on /docs:\n")
    print(token)


if __name__ == "__main__":
    main()
