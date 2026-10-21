# classiflow

Complex classifications made easy.

Open-source. AI-assisted. User-friendly.
Built for ISCO, ISIC, COICOP, and beyond.

classiflow is an open-source labeling platform for hierarchical classifications. It provides the user interface and database for classification workflows.
AI labeling and learning are handled by the separate Taxomind service (https://github.com/rowsquared/taxomind). You can run classiflow without AI and connect it later.

## Why classiflow

- Faster classifications with AI-assisted suggestions reviewed by humans
- Higher quality with flags, comment threads and supervisor review (independent double annotation is [planned](docs/ideas.md))
- Simple process management with assignments and progress tracking
- Open-source and self-hosted so you stay in control

## Highlights

- Multi-level taxonomies (up to 5 levels) with CSV import and custom level names
- Fast labeling UI with search, keyboard shortcuts, flags, and comments
- Optional AI suggestions and learning via Taxomind
- Role-based access for admins, supervisors, and labellers
- Progress analytics and team performance dashboards
- Flexible workflows with assignments, skip and flag states

## Getting started

The simplest way to try classiflow is with Docker Compose.

1. Clone the repository:
```bash
git clone https://github.com/rowsquared/classiflow.git
cd classiflow
```

2. Copy the environment template and fill in `POSTGRES_PASSWORD`, `NEXTAUTH_SECRET`
   and `DEFAULT_ADMIN_PASSWORD` (see [ENV_SETUP.md](ENV_SETUP.md)):
```bash
cp .env.example .env
```

3. For local access, uncomment the app port mapping in `docker-compose.yml` (3000:3000).
4. Optional: enable AI suggestions by deploying Taxomind and setting `AI_LABELING_API_URL` and `AI_LABELING_API_KEY` in `.env`.
5. Start the stack:
```bash
docker compose up -d --build
```
6. Open http://localhost:3000, log in with the default admin, and change the password.

For hosted setup or a demo, see https://rowsquared.com/classiflow/.

## Configuration

All variables (required, optional, defaults, which are secret) are in
[ENV_SETUP.md](ENV_SETUP.md). AI suggestions stay off until `AI_LABELING_API_URL`
and `AI_LABELING_API_KEY` are set.

## First Login

The first admin is created on the first start from `DEFAULT_ADMIN_USERNAME`
(default `admin`) or `DEFAULT_ADMIN_EMAIL`, and `DEFAULT_ADMIN_PASSWORD`. You must
choose a new password at first sign-in.

## FAQs

- **What is classiflow?** An open-source, AI-assisted platform for hierarchical classifications and labeling.
- **How much does it cost and where can I find it?** It is open-source and free to use. You can self-host from this repository, or request hosted setup via https://rowsquared.com/classiflow/.
- **Do I need data scientists or technical expertise to use it?** No. It is designed for domain experts and field teams, not data scientists.
- **Can I trust the AI predictions?** AI suggestions are optional and are always reviewed by humans. Corrections improve model quality over time.
- **Where does my data go?** With self-hosting, your data stays on your infrastructure. If you enable AI suggestions, data is sent to your Taxomind service.
- **What classification systems does it support?** Built for ISCO, ISIC, COICOP, and beyond.
- **How does it integrate with my workflow and can I customize it?** Use flexible assignments, filters, comments, and flags. The project is open-source and can be customized.
- **What kind of support do you offer?** We can help with setup, integration, and custom features. See https://rowsquared.com/classiflow/ for more info.

## Documentation

Each topic lives in one place:

| Document | Covers |
| --- | --- |
| [README.md](README.md) | What classiflow is, quick start |
| [ENV_SETUP.md](ENV_SETUP.md) | Every environment variable |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Local development setup and commands |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Running in production: start command, database roles, health, backups, admin recovery, reverse proxy |
| [COOLIFY_DEPLOYMENT.md](COOLIFY_DEPLOYMENT.md) | Coolify-specific setup, deploy triggers and releases |
| [docs/security.md](docs/security.md) | Who can see and change what (access matrix) |
| [AGENTS.md](AGENTS.md) | Architecture and conventions for contributors and coding agents |
| [docs/plans/hardening-handoff.md](docs/plans/hardening-handoff.md) | State of the 2026 hardening work and the [review](docs/reviews/2026-10-21-review.md) behind it |
| [docs/plans/modernization-2026-10.md](docs/plans/modernization-2026-10.md) | Proposed framework, library and runtime upgrades (Next 16, Prisma 7, auth) |

## License

MIT. See `LICENSE`.

## Support

Open a GitHub issue for bugs or feature requests.
