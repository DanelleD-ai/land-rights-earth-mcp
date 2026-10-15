
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

const PROPERTY_API =
  "https://citymaps.capetown.gov.za/agsext/rest/services/Theme_Based/Land_Administration/MapServer/14/query";

function createServer() {
  const server = new McpServer({
    name: "cape-town-gis",
    version: "1.0.0"
  });

  server.registerTool(
    "get_property_by_sg26",
    {
      title: "Find Cape Town Property",
      description:
        "Find a City of Cape Town property by its exact SG26 cadastral code. Returns property details, zoning and polygon coordinates.",
      inputSchema: {
        sg26_code: z.string().min(1).max(26)
      }
    },
    async ({ sg26_code }) => {
      try {
        const params = new URLSearchParams({
          where: "SG26_CODE='" +
            sg26_code.replace(/'/g, "''") + "'",
          outFields: "*",
          returnGeometry: "true",
          outSR: "4326",
          f: "json"
        });

        const response = await fetch(
          `${PROPERTY_API}?${params}`,
          { signal: AbortSignal.timeout(15000) }
        );

        if (!response.ok) {
          throw new Error("City GIS API unavailable");
        }

        const data = await response.json();

        if (data.error) {
          throw new Error(data.error.message || "GIS query failed");
        }

        const features = data.features || [];

        if (features.length === 0) {
          return {
            content: [{
              type: "text",
              text: "No property found with that SG26 code."
            }]
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: features.length,
              properties: features.map(feature => ({
                attributes: feature.attributes,
                geometry: feature.geometry
              }))
            })
          }]
        };

      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: error.message
          }]
        };
      }
    }
  );

  return server;
}

export default {
  async fetch(request) {
    // Require a configured secret before accepting MCP requests.
    const token = process.env.MCP_API_TOKEN;

    if (!token) {
      return new Response("Server not configured", {
        status: 503
      });
    }

    if (request.headers.get("authorization") !==
        `Bearer ${token}`) {
      return new Response("Unauthorized", {
        status: 401
      });
    }

    const server = createServer();
    const transport =
      new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });

    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } catch (error) {
      console.error("MCP request failed:", error);
      return new Response("Internal server error", {
        status: 500
      });
    }
  }
};
