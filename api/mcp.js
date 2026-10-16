
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

  server.registerTool(
    "search_properties",
    {
      title: "Search Cape Town Properties",
      description:
        "Search City of Cape Town properties by street address, erf number or suburb. Returns matching property records and SG26 codes. For a full property boundary, use get_property_by_sg26.",
      inputSchema: {
        search_type: z.enum(["address", "erf", "suburb"]),
        query: z.string().min(1).max(100),
        suburb: z.string().max(100).optional()
      }
    },
    async ({ search_type, query, suburb }) => {
      try {
        const clean = (value) =>
          value.trim().toUpperCase()
            .replace(/'/g, "''")
            .replace(/[%_]/g, "");

        let where;

        if (search_type === "erf") {
          const erf = query.trim();

          if (!/^\d{1,15}$/.test(erf)) {
            throw new Error("Erf number must contain digits only.");
          }

          where = `PRTY_NMBR='${erf}'`;
        } else if (search_type === "address") {
          const match = query.trim().match(/^(\d+)\s+(.+)$/);

          if (match) {
            where = `ADR_NO=${Number(match[1])} AND UPPER(STR_NAME) LIKE '%${clean(match[2])}%'`;
          } else {
            where = `UPPER(STR_NAME) LIKE '%${clean(query)}%'`;
          }
        } else {
          where = `UPPER(OFC_SBRB_NAME) LIKE '%${clean(query)}%'`;
        }

        if (suburb?.trim()) {
          where += ` AND UPPER(OFC_SBRB_NAME) LIKE '%${clean(suburb)}%'`;
        }

        const params = new URLSearchParams({
          where,
          outFields: "OBJECTID,SG26_CODE,PRTY_NMBR,ADR_NO,STR_NAME,OFC_SBRB_NAME,ZONING,LU_LGL_STS_DSCR",
          returnGeometry: "false",
          resultRecordCount: "10",
          f: "json"
        });

        const response = await fetch(
          `${PROPERTY_API}?${params}`,
          { signal: AbortSignal.timeout(15000) }
        );

        if (!response.ok) {
          throw new Error(`City GIS returned HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
          throw new Error(data.error.message || "GIS query failed");
        }

        const properties = (data.features || []).map(
          (feature) => feature.attributes
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count_returned: properties.length,
              more_results_possible: Boolean(data.exceededTransferLimit),
              properties,
              note: "Search results are limited to 10. Confirm the correct SG26 code before retrieving a property boundary."
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

   const authHeader = request.headers.get("authorization");

if (authHeader !== `Bearer ${token}`) {
  console.warn("MCP authentication diagnostic", {
  headerPresent: authHeader !== null,
  authScheme: authHeader
    ? authHeader.trim().split(/\s+/)[0].slice(0, 20)
    : "missing",
  bearerPrefix: authHeader?.startsWith("Bearer ") ?? false
});
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
