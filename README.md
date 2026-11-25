# maket

English | [Русский](README.ru.md)

A web application for diagram modeling with built-in and custom notations.

**Stack:** Next.js 15, React 19, TypeScript, React Flow, PostgreSQL 17, Prisma 6 (JavaScript engine + pg), Zod.

## Features

- Solution explorer: solutions, projects, folders, objects, relations, and diagrams in a shared hierarchy. Organize elements and diagrams, drag them between containers, and use representation folders to navigate to a specific representation. [Model concepts and rules](docs/solutions.md).
- Invitation-code registration, sign-in, sign-out, password recovery, and password changes. Passwords use scrypt; sessions use random tokens, hashes stored in the database, and an HttpOnly cookie. Password recovery terminates existing sessions.
- Unified workspace: browse the model tree and diagrams; create, import, search, sort, rename, duplicate, and delete diagrams.
- Editor: notation-based palette, canvas, shapes, ports, connections, element and relation properties, dragging, resizing with handles or the inspector, arbitrary stacking levels, zoom, minimap, deletion, undo, and redo. Double-click to edit text; font size, rotation, and alignment are configurable. Additional attributes can appear on objects.
- Notations: built-in flowchart notation, duplication, appearance and shape editors based on basic shapes and control points, a full JSON editor, import, export, and immutable versions. Properties, ports, and complex rules are edited through JSON. Connections support different line styles, widths, routes, and markers at both ends.
- Client- and server-side validation of structure and rules: property types, required fields, permitted connection directions, loops, and port limits.
- Autosave after dragging, resizing, or editing text; manual saving; the last 100 revisions and restoration. Each gesture is one undo step. Protection against overwriting concurrent changes.
- Import/export of `.maket.json` files with embedded notation; `.notation.json` files for notations.
- User name, light/dark theme, grid snapping, and autosave preferences.

Diagram viewpoints and navigation between them are described in [docs/viewpoints.md](docs/viewpoints.md).
The viewpoint explorer is available in the workspace and editor. Decomposition expands
an object within the same viewpoint; drilling down opens its representation in another
context. Navigation is not restricted to adjacent levels.
Context menus for objects, relations, and representations provide direct links to existing
decompositions and other viewpoints. Each menu lists only diagrams linked to that object,
with the viewpoint and the meaning of the transition. Changes are saved before leaving
the editor, and an existing representation is selected in the destination viewpoint when available.

## Local setup

Requires Node.js 22+ and PostgreSQL 17 (or Docker Compose).

```bash
npm ci
cp .env.example .env
# If PostgreSQL is already running, configure POSTGRES_HOST/PORT/USER/PASSWORD/DB/SCHEMA and skip Compose.
docker compose up -d --wait
npm run db:generate
npm run db:migrate
npm run dev
```

Prisma Client is generated automatically after `npm ci`, before `npm run dev`, and before creating a test user. Install dependencies including devDependencies: the `prisma` CLI is required before building the application. `npm run build` also generates the client.

Generation works before `.env` exists and does not connect to the database. If `DATABASE_URL` is absent, the script passes a placeholder URL only to the Prisma child process. The application and migrations use your actual configuration without this fallback.

If you see `Cannot find module '.prisma/client/default'`, stop the server and run the following from the project root:

```bash
npm ci --include=dev
npm run db:generate
npm run dev
```

Installing with `--ignore-scripts` disables automatic npm hooks; explicitly run `npm run db:generate` before starting. Do not copy `node_modules` between machines: install dependencies and generate the client on the target machine. For production, run `npm run build` after generation, then `npm start`.

Open `http://localhost:3000`. Once the application is ready, the console prints `[maket invite] <code>`. Enter this code on the registration page to create an account; email verification is not required. The code is shared for the current run and changes after a restart. In development, password recovery links are printed to the console with the `[maket mail]` prefix. No test account or shared password is created automatically.

In the configured cloud environment, PostgreSQL runs in the `maket-postgres` container. Use `docker start maket-postgres` to restart it instead of creating a second server on port 5432.

`.env` is not committed. The example database password is for local development only; use your own secrets and a managed database on the server.

## Test user

After configuring the database and applying migrations, you can create a user without an email service:

```bash
# Bash: enter a password without displaying it or saving it in shell history.
read -r -s -p 'Test user password: ' TEST_USER_PASSWORD
printf '\n'
export TEST_USER_PASSWORD
npm run user:create-test -- --email test@example.com --name "Test user"
unset TEST_USER_PASSWORD
```

The password must contain 10–128 characters. The new user's email is immediately marked as verified, and the account uses the regular sign-in form. The password is stored as a scrypt hash and is never printed by the script. Running the command again does not change an existing account, its password, or its verification status.

For automation, supply the password through `TEST_USER_PASSWORD` or standard input with `--password-stdin`. The default email is `test@example.com`; email and name can also be set through `TEST_USER_EMAIL` and `TEST_USER_NAME`. The command uses the database configured by the `POSTGRES_*` fields in `.env`. Help: `npm run user:create-test -- --help`.

## Checks

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

E2E tests start a development server and check the invitation code and recovery links from its local log at `/tmp/maket-e2e-server.log`, the API, and browser workflows. Use a separate test database: tests create temporary users and delete them afterward. Stop any other server on port 3000 before running E2E tests, or its email log may be unavailable. In the cloud environment, you can use the preinstalled browser:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e
```

Production build and startup: `npm run build && npm start`. Building does not run migrations automatically.

## Email and deployment

Registration uses an invitation code from the application logs and does not send email. To enable password recovery by email, also configure:

- `PUBLIC_ORIGIN`: the canonical HTTPS origin for recovery links, without a subpath;
- `APP_URL`: only the subpath (`/maket` or an empty value), not the website URL;
- `MAIL_WEBHOOK_URL`: your email service's HTTPS endpoint;
- `MAIL_WEBHOOK_TOKEN`: the service's authorization secret.

The service receives a `POST` JSON body `{ "to": "...", "subject": "...", "text": "link" }` with an `Authorization: Bearer ...` header and must return a 2xx response. Without this service, password recovery by email is unavailable in production; invitation-based registration still works. Do not expose the development server or email logs publicly. Restart the process after changing the configuration.

Before releasing, configure HTTPS, PostgreSQL backups, and monitoring, and test database restoration. Google OAuth is not integrated in this version. PNG/JPEG/PDF export and collaboration are described below.

## Formats and architecture

See [document formats](docs/formats.md) and [architecture and next steps](docs/architecture.md).

SQL migrations are stored in `prisma/migrations`. `npm run db:migrate` applies them through pg, using a lock against concurrent execution, a transaction per migration, and SHA-256 verification of previously applied files. History is stored in `_maket_migrations`. Do not mix this process with `prisma migrate deploy` for the same database: Prisma uses a separate history table.

The separate SQL runner exists because Prisma 6.19's JavaScript Schema Engine cannot deserialize the PostgreSQL catalog type `name` during introspection. Prisma Client generation and queries through the pg driver work without native binaries. For future schema changes, create reviewed SQL migrations, update `schema.prisma`, and run `db:generate`. Never edit an applied migration.

## Workspaces

The switcher above the sidebar menu lets you create a workspace or open an existing one. Each workspace has independent objects, solutions, projects, relations, viewpoints, diagrams, and history. The diagram browser, tree, and graph display only the current workspace. Notations and user settings are available across the account's workspaces.

When upgrading, the existing model remains the first workspace; new workspaces start empty. Your selection is remembered for subsequent visits. An open tab continues using its own workspace even if another tab selects a different one. The editor's unsaved-changes protection applies before switching.

The server checks that every ID belongs to the current workspace. Transferring data through export/import creates new, independent objects. A public link still opens only its diagram, regardless of the owner's selected workspace.

For the API, the current workspace is selected with the `X-Maket-Workspace` header. Without it, the first workspace is used for compatibility with older clients. `GET /api/workspaces` returns owned workspaces and those accessible through membership; `POST /api/workspaces` with `{ "name": "Name" }` creates an empty workspace. After upgrading, run `npm run db:migrate` and `npm run db:generate`.

## Viewpoint layers · 2.5D

The "Viewpoint layers · 2.5D" button in the workspace and editor opens a separate mode within the same work area. Viewpoints appear as tilted planes in the configured order, with diagrams shown as three-dimensional tiles containing previews and names on their top faces. Viewpoint labels sit on the right, connected to layers by dashed lines; curved arrows on the left indicate viewpoint order and are not model relations. The view uses SVG and React Flow; WebGL and Three.js are not required.

You can collapse and expand layers, hide individual viewpoints, search diagrams, filter relation types, and show only cross-layer transitions. Zoom, background panning, and a minimap help navigate large scenes. Cross-layer connections are aggregated when layers are collapsed; selecting a line reveals specific transitions and their meaning. The inspector provides links to a diagram or a relation in the tree. Changes are saved before navigating away from the editor.

The explorer displays existing decompositions, transitions to other viewpoints, and direct model relations between diagrams. If a transition has no source diagram, actual representations of the object on other diagrams are used; this is explicitly noted in the inspector. Transitions with no known source are listed separately, without inventing connecting lines. Diagrams without an assigned viewpoint appear on a separate layer. The view operates only within the selected workspace and does not create objects or representations.

## Solution relation graph

The "Solution graph" button in the workspace and editor opens an interactive graph in the same work area. Select a solution or the entire personal model, search objects and relations, drag nodes, zoom, highlight relation types, and show only a selected element's neighborhood. The inspector shows properties, relation participants, and links to the tree or diagram. Current changes are saved before leaving the editor.

Each object appears once in the graph, regardless of how many representations it has on diagrams. Relations are independent nodes between their sources and targets: the graph includes relations without diagrams, decomposition, drilling down, relations connected to other relations, and objects nested inside relations. Participants from another solution are marked "Outside the solution"; other objects from that solution are not included. Organizational containment can be enabled separately and appears as dashed lines.

The graph is available to the authenticated model owner. It is a viewer: dragging nodes does not change objects or diagrams. "Refresh" loads the current model while preserving the arrangement; "Reset layout" restores the automatic layout. The arrangement lasts only until the graph is closed.

## Object model and multiple notations

The personal model tree is available next to the palette. Create an object in the tree, choose its appearance for placement, and drag it onto the canvas; "Place" creates another representation of the same object. A palette item creates a new object and its first representation. Nesting in the tree does not change the canvas.

In diagram properties (open the title in the editor or the diagram entry in the tree), "Diagram notations" lets you connect several fixed notation versions. The palette is divided by notation, and "Object appearance" in the inspector changes the selected representation's skin. When starting a connection, the editor selects a relation type from the source representation's notation, preserving an explicitly chosen type within that notation; the connection list is grouped by notation. Shared properties are accessible through the tree and inspector; double-clicking sets a local label. Archiving an object preserves its representations and history. The tree's trash action deletes an unused object without representations or children; for objects still in use, the reason deletion is blocked is displayed.

Arrows also have a shared model: "Model relations" stores the name, description, attributes, and two participants of a relation. References to relations are grouped under each participant in a collapsible "Relations" folder. "Place relation" creates another arrow between selected representations, with an independent label and appearance. Deleting an arrow leaves its relation in the model. A relation without representations can be deleted from the explorer; an object with remaining relations cannot be deleted. Shared relation properties support history and archiving.

The button in each panel's header hides the tree, palette, or properties. Hover over the work area's edge to reveal a hidden panel; the same button is available through the keyboard and touch. Resize the tree by dragging its boundary or using the arrow keys. Panel widths and visibility are saved per user. The crosshair action locates a representation, the plus action places one on the diagram, and the folder-plus action creates a child object.

"Restore relation representation" is available directly on a relation reference in the tree. Objects and relations can be nested under a relation: create a child object, drag an existing one, or select a parent in properties. Below the midpoint of each arrow, two neutral connection points allow connections to objects and other arrows through an "Explanatory relation". Drag an arrow end to a compatible port on another element or to an empty location. The inspector also provides "Detach source" and "Detach target" commands. Free endpoints retain their positions across saving, import, and restoration. Rebinding to a different model participant creates a separate relation with a reference to the original; other representations keep their previous relation. Arrows attached to the modified arrow are updated consistently. Deleting a representation also removes arrows attached to it from the canvas, while retaining all shared relations in the model for later placement. A relation with children or participation in another relation cannot be deleted from the model.

Copies of objects and relations include "Copied from": the source ID and name at the time of copying. This is informational metadata without a foreign key or synchronization; the original can be deleted while the copy's provenance remains. Placing another representation uses the same object or relation and does not count as copying.

After upgrading, run `npm ci` and `npm run db:migrate`, then restart the application. Older diagrams are automatically converted to v2 when the model or library is first opened; older files are accepted through library import. Back up the production database before upgrading. Details of the new format, import, properties, and history are in [docs/formats.md](docs/formats.md).

## Public viewing and export

The editor's "Share" button saves changes and opens access management. Enabling "Access by link" creates a random address at `/view/<token>`. An external user sees the latest saved diagram and its object tree, can pan and zoom, and can select elements. Object management and diagram editing remain available only to the owner after signing in. The rest of the library and unrelated model objects are not sent to the viewer.

The link remains stable when access is disabled and re-enabled. Only "Generate new" changes the address and invalidates the previous link; the current access state is preserved. An open viewer checks access every 15 seconds. Previously downloaded files remain with the recipient. Disabling access temporarily closes viewing through the same link. Duplicating a diagram does not copy public access.

Add `?element=<representation-id>` to link to a specific shape or arrow, including an individual representation of an object. `?object=<object-id>` is also supported and selects its first representation. In the editor, "Link to selected element" appears in the Share dialog; in the viewer, selecting an element updates the address and lets you copy it using "Link to element".

"Export" offers PNG, JPEG, PDF, and draw.io; the editor also retains JSON for re-import. The image includes the entire diagram, labels, visible attributes, shapes, layers, and arrow styling on a white background. The PDF contains the diagram image on one page. For large diagrams, resolution is automatically limited to 8192 pixels per side and 16 million pixels in total.

A `.drawio` file opens in draw.io / diagrams.net as an editable diagram. Coordinates, dimensions, labels, appearance, custom shape outlines, and connections are preserved. Element data includes `maket_object_id`, `maket_representation_id`, `maket_relation_id`, properties, and snapshots of the original entities. Multiple representations of one object retain a shared object ID and distinct cell IDs. See [the draw.io export format](docs/formats.md#экспорт-в-drawio).

Import `.drawio` and XML files through the library's "Import" button. All pages, their objects, and their relations are created in a new folder at the workspace root, named after the file. Both plain and compressed files, properties, and repeated representations from maket metadata are supported. Details and limits: [draw.io import](docs/formats.md#импорт-из-drawio).

When updating the application, run `npm ci` and `npm run db:migrate`, then restart the server. Migration `20261008000000_public_viewer` adds a nullable link field; existing diagrams remain private.

Migration `20261008010000_persistent_share_links` separates the persistent address from access status. Previously enabled links retain their addresses and access.

## Object inheritance and instances

Object context menus in the workspace and editor tree provide "Create derived object" and "Create instance". Creation atomically adds a new object and a semantic relation from the base to the descendant, with type `наследует` (inherits) or `экземпляр` (instance). Tree containment and an ordinary copy's source reference do not define inheritance. Existing objects can be connected using these types in the relation manager: the source is the base, and the target is the descendant. A descendant has one active base; cycles and relations across workspaces are prohibited.

Attributes are resolved across the entire chain: base → the object's own values → local representation values. Base changes apply automatically. The object card shows inherited attributes and supports local overrides; deleting an override restores the base value. Archiving or deleting the special relation ends inheritance. Instances are marked with `«instance»` on diagrams, in public viewing, exports, and the 2.5D view; relation representations receive `«extends»` / `«instance»` labels and different line styles. Creating a relation does not create a representation automatically: it can be placed from the tree like other relations.

Creation API: `POST /api/objects` with `name`, `baseId`, `derivation: "inheritance" | "instance"`, and optional local `attributes`. Diagram JSON includes all required base objects and relations even without their representations; importing creates an independent chain with new identifiers. No database schema changes are required.

## Public object properties

The "Shared object properties" card displays the ID in a read-only field. "Share object" enables unauthenticated viewing through `/view/object/<id>/<key>`. The card shows the name, description, type, and effective attributes, distinguishing local and inherited values. The workspace tree, relations, other objects' data, and access settings are not published.

The link is preserved when access is disabled and re-enabled. "Generate new" replaces the key and revokes the previous link; the object ID stays unchanged. Importing or copying objects does not transfer link access. Management API: `GET/POST /api/objects/<id>/share`; update body: `{ "enabled": true, "rotate": false }`.

After updating an existing database, apply the migration with `npm run db:migrate`. Prisma Client generation runs during dependency installation and builds.

### Workspace collaboration

The role button in the top bar opens "Members and access". The owner or an administrator can add an existing user by verified email, assign a role, and revoke access. An invited workspace appears in that user's switcher; personal notations and settings remain their own. Public viewing links work independently of membership.

Built-in roles: administrators manage access and content; moderators can also delete, publish, and release locks; editors create and edit content; viewers cannot make changes. The owner retains full access. Custom roles specify actions and an optional list of editable element IDs. All members can view the entire workspace: the element list restricts changes, not viewing confidentiality. Restrictions are not inherited through the tree. Editing a diagram requires permissions for the diagram, its tree object, and all involved objects and relations. Roles with administrative actions apply to the whole workspace.

Multiple participants can edit the same diagram simultaneously. Opening the canvas does not lock the entire diagram. Changes to shapes, connections, and their individual properties are merged against a shared saved revision: independent edits are saved together, while conflicting changes to the same property and deletion of a concurrently edited element are rejected with HTTP 409. Position and size are treated as complete gestures so that coordinates from two authors are never mixed. Representations are added atomically on top of the current version. Incoming updates are merged with unsaved changes, and undo history preserves collaborators' edits. On conflict, the local version remains in the editor for export and comparison with the server version; it is not overwritten automatically. Character-level CRDT editing within a single text field is not implemented.

Shared property cards for objects and relations still acquire temporary locks. Locking a specific object prevents changes to its representations but allows editing other shapes in the diagram. Locks are renewed every 12 seconds, expire after 45 seconds without renewal, and are released when the card closes. If a lock is lost or forcibly released, use "Acquire access". Explicitly locking an entire diagram through the API still applies to all its content.

The workspace version is checked every 2 seconds; updates are loaded into open trees, the library, graph, viewpoints, and diagrams. Unsaved local changes are merged with incoming data; conflicts preserve the local version. The log displays the last 100 successful operations with their author, time, and affected element. Membership, roles, locks, and save validation are enforced by the server and PostgreSQL, including deployments with multiple application instances. Writes within a workspace are briefly serialized with a PostgreSQL advisory lock; high loads will require more narrowly scoped operation locks.

Before upgrading, run `npm run db:generate` and `npm run db:migrate`. Check collaboration with `npm run test:e2e -- tests/e2e/collaboration.spec.ts` (set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` for an installed Chromium browser).

For the API, collaborative saving is enabled by `concurrent: true` in `PUT /api/diagrams/:id`, alongside the base `revision` and `document`. Without this field, the previous strict revision check applies. The same field in `POST /api/diagrams/:id/representations` allows atomic addition to the current diagram when the supplied revision is outdated. This update requires no database changes.

## Interface design

Shared visual principles, element behavior, accessibility, and screenshot checks are described in [the interface design document](docs/interface-design.md).

## Docker deployment

For the production image, PostgreSQL, automatic migrations, `APP_URL` through `.env.production`, backups, and updates, see [the deployment guide](docs/deployment.md). Standard flowchart, BPMN, and UML notations are available automatically. The local `compose.yaml` starts PostgreSQL only.

For `/maket`, set `APP_URL=/maket` and use [the Nginx snippet](deploy/nginx/maket.conf). Database settings use separate `POSTGRES_*` fields; you do not need to assemble a connection URL manually.

## Security

Audit findings, fixes, and secure deployment requirements: [security audit](docs/security-audit.md).

## Product wiki

Built-in documentation is available without authentication at `/wiki` (or `/maket/wiki` when `APP_URL=/maket`). "Wiki and help" in the main menu opens it in a new tab. It includes full-text search, topic navigation, article tables of contents, a mobile layout, and a separate theme switcher.

The 16 articles cover current features: getting started, the object model, library and history, editor, relations, notations, viewpoints, the graph and 2.5D, inheritance, collaboration, publishing, settings, connecting LLMs through MCP, desktop/portable, deployment, and troubleshooting. Content is maintained in `src/lib/wiki.ts` and ships with the application; no separate service, database, or Nginx configuration is needed for the wiki. Articles are public: do not include real passwords, invitation codes, or workspace data.

## MCP for LLMs

Under "Settings → LLM integration · MCP", create a Bearer key, select workspaces, and choose capabilities separately for each workspace. Endpoint: `/api/mcp` (or `/maket/api/mcp` when `APP_URL=/maket`); transport: **Streamable HTTP**; header: `Authorization: Bearer <key>`. Use HTTPS and an MCP client that supports this header; OAuth is not implemented yet. The maket server does not require any LLM provider keys.

- Search by name/ID, paginated lists, object/relation properties, and inherited attributes.
- Create solutions, projects, folders, objects, relations, diagrams, and representations. Containment through `parentId` and relations through `sourceId`/`targetId` are separate operations.
- Export JSON, draw.io, PNG, JPEG, and PDF; import JSON and draw.io/XML. Exports return an MCP embedded resource with a base64 `blob`; input files use UTF-8 or base64. draw.io import creates a new root folder named after the file.
- Permissions per capability/format, expiration, permission updates, and key revocation. A key is shown only once; its SHA-256 hash is stored. Changing or resetting a password revokes keys.
- Current workspace membership, roles, element restrictions, revisions, and locks are checked. A key cannot expand its owner's permissions. A public viewing link does not grant workspace access. Import requires workspace-wide creation permission and itself authorizes the creation of imported objects and relations. JSON/draw.io exports include properties independently of access to the separate property-reading tool.

Lists are limited to 100 entries per page, property reads to 50 IDs, and the entire request to 2 MB (base64 increases size). Export files are limited to 8 MB, raster images to 16 million pixels, and each key to 600 requests per 15 minutes. Permission changes apply to subsequent requests. Separate tools for updating or deleting existing objects are not provided.

Details and an SDK client example: `/wiki/mcp`. After updating containers, the standard migrate service applies migration `20261124000000_mcp_keys`.

## Desktop and portable

The standalone edition is released separately for Windows x64, Linux x64, macOS Intel, and Apple Silicon. Installers and portable builds are available in [GitHub Releases](https://github.com/DoshikKing/maket/releases) under `desktop-v…` tags. Node.js, Docker, and PostgreSQL do not need to be installed: everything required is bundled. A local profile is created automatically.

Desktop uses separate dependencies in `desktop/`, a separate Next output directory at `.next-desktop`, and its own local database. Server `.env` files, databases, and Docker startup remain independent. Portable stores data next to the application; the installed edition stores it in the user profile. A backup is created automatically before upgrading the database. Public publishing and collaboration over the internet are available in the server edition; local MCP works with a client on the same computer.

Platform, storage, build, and release instructions: [desktop/README.md](desktop/README.md), and built-in help at `/wiki/desktop`. Builds are not yet signed or notarized by Apple.
