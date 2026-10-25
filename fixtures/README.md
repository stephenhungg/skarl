# Fixtures

This directory is reserved for small, explicitly synthetic demonstration inputs and public, redistributable examples. No real contributor videos, private financial records, wallet credentials, consent signatures, or proprietary datasets belong in Git.

Evaluation metadata examples live in `evals/`. They contain no media and do not represent model results. The verifier's own examples live under `services/verifier/examples/`.

For a future media fixture, record its source, license or permission, original SHA-256, duration, recording session, actor identifier, expected labels, and any transformations. Keep all derivatives of an original recording in the same dataset split. Public evidence examples should be purpose-recorded by the team with explicit permission; actual contributor uploads stay in private object storage.

Payment examples must use Base Sepolia test USDC and be labeled as test transactions. Never commit private keys, signed payment authorizations, private storage URLs, or local `.env` files.
