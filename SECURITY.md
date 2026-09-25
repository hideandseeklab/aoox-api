# Security Policy

## Reporting a vulnerability

Please report security issues privately by emailing **hideandseek.developer@gmail.com** instead of
opening a public issue. Include steps to reproduce and the potential impact. We will acknowledge
the report and follow up with a fix timeline.

## Threat model and known trade-offs

aoox is a self-hosted PaaS aimed at trusted operators (an owner/admin has, by design, root-equivalent
access to the Docker host it manages). Some behaviors that look like footguns are intentional:

- **Web terminal**: owners/admins can open a shell on the managed host (or inside the API container)
  over SSH. SSH host keys are not verified on first connect. Only
  expose this to operators you trust, on a network you control.
- **Generic outgoing webhooks**: a notification channel can be configured with an arbitrary URL, which
  is SSRF by design — the person configuring it already has host-level access.
- **Compose stacks**: a stack's `docker-compose.yml` can request `privileged` containers or host binds.
  Owners/admins already have host shell access, so this is not a privilege escalation for them.
- **API tokens** (`aoox_...`) act as the user that created them, scoped by read-only/project restrictions
  where configured; treat them like passwords.

If you find a way to reach any of the above from a *lower*-privileged role (developer/viewer/member,
or an unauthenticated request), that is a genuine vulnerability — please report it as above.

## Supported versions

This project is pre-1.0; only the latest `main` is supported.
