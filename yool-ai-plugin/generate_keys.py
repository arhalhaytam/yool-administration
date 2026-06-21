"""
Generate RSA-2048 key pair for JWT RS256 signing.
Run once before starting the project:
    pip install cryptography
    python generate_keys.py
"""

import os
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.backends import default_backend

SECRETS_DIR = Path(__file__).parent / "secrets"
PRIVATE_KEY_PATH = SECRETS_DIR / "jwt_private.pem"
PUBLIC_KEY_PATH  = SECRETS_DIR / "jwt_public.pem"


def generate():
    SECRETS_DIR.mkdir(exist_ok=True)

    # Ensure secrets dir is not committed
    gitignore = SECRETS_DIR / ".gitignore"
    gitignore.write_text("*\n")

    # Generate RSA-2048 private key
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
        backend=default_backend(),
    )

    # Serialize private key (PKCS8, no encryption — kept in Docker secrets / volume)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )

    # Serialize public key
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    PRIVATE_KEY_PATH.write_bytes(private_pem)
    PUBLIC_KEY_PATH.write_bytes(public_pem)

    # Restrict permissions on private key
    os.chmod(PRIVATE_KEY_PATH, 0o600)

    print(f"✅  Private key → {PRIVATE_KEY_PATH}")
    print(f"✅  Public key  → {PUBLIC_KEY_PATH}")
    print()
    print("⚠️   Never commit the secrets/ directory.")
    print("    The private key is used only by the auth service.")
    print("    The public key is mounted read-only to all other services.")


if __name__ == "__main__":
    if PRIVATE_KEY_PATH.exists():
        answer = input("Keys already exist. Overwrite? [y/N] ")
        if answer.lower() != "y":
            print("Aborted.")
            raise SystemExit
    generate()
