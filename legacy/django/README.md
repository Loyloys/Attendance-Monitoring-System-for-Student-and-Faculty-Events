# Archived Django implementation

This directory preserves the original Python/Django/SQLite implementation and its database after the verified conversion to Node.js, Express, and MongoDB.

- It is not used by the active application or launcher.
- `db.sqlite3` is the source for `npm run migrate` in `backend/`.
- Timestamped backups created by the migration are stored in `backend/backups/` and ignored by Git.
- The pre-conversion implementation remains recoverable from Git history.

Do not start this runtime for normal application use. Refer to the root `README.md` for the active setup.
