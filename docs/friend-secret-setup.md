# Friend secret setup

Use a friend bundle supplied by a trusted maintainer. The bundle contains only allowlisted provider and COS configuration and must remain outside this Git repository.

```bash
git clone https://github.com/gearaldblynn-lang/Meiao.git
cd Meiao
npm ci
npm run secrets:import -- /absolute/path/.env.meiao.friend
npm run doctor
```

The import command creates or updates the local `.env.server` without printing secret values. Keep `/absolute/path/.env.meiao.friend` outside the cloned repository, do not commit it, and do not paste its values into Markdown, source files, examples, issues, or chat logs. If a maintainer needs to prepare a bundle, they use the repository's `npm run secrets:export` command against a local source environment and transfer the resulting bundle through an approved private channel.

Provider keys can create billable requests. COS credentials can access shared storage. Treat both as sensitive: use only the access granted to you, do not share the bundle, and ask the maintainer before changing or rotating anything.

The friend bundle does not configure local infrastructure. MySQL, Temporal, FFmpeg, and local administrator access remain separate local prerequisites; obtain and configure them through the maintainer's normal setup process.
