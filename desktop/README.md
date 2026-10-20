## Photos desktop

The Photos desktop app: a standalone, offline photo library for Linux, Windows
and macOS, backed by a local vault (no servers, no accounts).

This is a fork; see the [main README](../README.md) for details.

## Building from source

1. Install [Node](https://nodejs.org) and [Rust](https://www.rust-lang.org/tools/install).

2. Install the web dependencies:

    ```sh
    cd web
    npm ci
    ```

3. Install the desktop dependencies:

    ```sh
    cd ../desktop
    npm ci
    ```

4. Run the desktop app:

    ```sh
    npm run dev
    ```

In development mode the desktop app supports hot reload for the renderer process.

> [!NOTE]
>
> If the relevant `package-lock.json` has not changed since your last `npm ci`, you can use `npm install` as a faster incremental alternative.

To create a static build for your platform:

```sh
npm run postinstall
npm run build
```

> [!NOTE]
>
> `npm run build` requires an explicit `npm run postinstall` prior to it (`npm run dev` will do it automatically if needed).
