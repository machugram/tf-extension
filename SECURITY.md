# Security

- **TFVC: Sign In** stores the password or PAT in editor Secret Storage, not in `settings.json`.
- `tfvc.login` is username only.
- The output channel redacts `/login:user,password` before logging command lines.
- Do not open issues or PRs that include collection credentials, PATs, or `tf` login output.

To report a vulnerability, email the maintainer listed on the GitHub profile rather than filing a public issue.
