# Google Earth Engine MCP Server

**Uses `@vercel/mcp-adapter`**
<img width="1658" alt="image" src="https://github.com/user-attachments/assets/28f1e354-5182-4f2d-91c5-c2c87de6ed79" />
<img width="1665" alt="image" src="https://github.com/user-attachments/assets/ce2c5900-c02e-41d0-b8f4-745af50e9a19" />



## Usage

This sample app uses the [Vercel MCP Adapter](https://www.npmjs.com/package/@vercel/mcp-adapter) that allows you to drop in an MCP server on a group of routes in any Next.js project.

Update `app/[transport]/route.ts` with your tools, prompts, and resources following the [MCP TypeScript SDK documentation](https://github.com/modelcontextprotocol/typescript-sdk/tree/main?tab=readme-ov-file#server).
## Google Earth Engine Tools

This project includes MCP tools for interacting with Google Earth Engine, a cloud-based platform for geospatial analysis. These tools allow AI assistants to:

- Initialize and authenticate with Earth Engine
- Visualize Earth Engine datasets as maps
- Retrieve information about Earth Engine datasets
- Compute statistics for Earth Engine data in specified regions
- Search for Earth Engine datasets

For more details, see the [Earth Engine Tools README](app/earthengine/README.md).

To use Earth Engine tools, you'll need:
1. A Google Earth Engine account
2. A Google Cloud service account with Earth Engine access
3. A service account private key for authentication

## Notes for running on Vercel

- To use the SSE transport, requires a Redis attached to the project under `process.env.REDIS_URL`
- Make sure you have [Fluid compute](https://vercel.com/docs/functions/fluid-compute) enabled for efficient execution
- After enabling Fluid compute, open `app/route.ts` and adjust `maxDuration` to 60 (or higher if using a Vercel Pro or Enterprise account)
- [Deploy the Next.js MCP template](https://vercel.com/templates/next.js/model-context-protocol-mcp-with-next-js)

## Sample Client

`script/test-client.mjs` contains a sample client to try invocations.

```sh
node scripts/test-client.mjs https://mcp-for-next-js.vercel.app
```
