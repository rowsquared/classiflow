# classiflow

Complex classifications made easy.

Open-source. AI-assisted. User-friendly.
Built for ISCO, ISIC, COICOP, and beyond.

classiflow is an open-source labeling platform for hierarchical classifications. It provides the user interface and database for classification workflows.
AI labeling and learning are handled by the separate Taxomind service (https://github.com/rowsquared/taxomind). You can run classiflow without AI and connect it later.

## Why classiflow

- Faster classifications with AI-assisted suggestions reviewed by humans
- Higher quality with review and double-annotation workflows
- Simple process management with assignments and progress tracking
- Open-source and self-hosted so you stay in control

## Highlights

- Multi-level taxonomies (up to 5 levels) with CSV import and custom level names
- Fast labeling UI with search, keyboard shortcuts, flags, and comments
- Optional AI suggestions and learning via Taxomind
- Role-based access for admins, supervisors, and labellers
- Progress analytics and team performance dashboards
- Flexible workflows with assignments and sign-offs

## Getting started

The simplest way to try classiflow is with Docker Compose.

1. Clone the repository:
```bash
git clone https://github.com/rowsquared/classiflow.git
cd classiflow
```

2. Copy the environment template:
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

Required:
- DATABASE_URL
- AUTH_URL
- AUTH_TRUST_HOST
- NEXTAUTH_URL
- NEXTAUTH_SECRET
- DEFAULT_ADMIN_EMAIL
- DEFAULT_ADMIN_PASSWORD
- DEFAULT_ADMIN_NAME

Optional AI labeling (Taxomind service):
- AI_LABELING_API_URL
- AI_LABELING_API_KEY
- AI_LABELING_BATCH_SIZE
- AI_LEARNING_BATCH_SIZE
- AI_LEARNING_MIN_NEW_ANNOTATIONS
- AI_JOB_POLL_INTERVAL_MS
- AI_JOB_POLL_TIMEOUT_MS

See `ENV_SETUP.md` for full details.

## First Login

The default admin user is created on first run using `DEFAULT_ADMIN_EMAIL` and `DEFAULT_ADMIN_PASSWORD`. Change the password immediately after first login.

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

- ENV_SETUP.md
- DEVELOPMENT.md
- DEPLOYMENT.md
- COOLIFY_DEPLOYMENT.md

## License

MIT. See `LICENSE`.

## Support

Open a GitHub issue for bugs or feature requests.
