import { createMcpHandler } from "@vercel/mcp-adapter";
import { z } from "zod";
import {
  initializeEarthEngine,
  getDatasetVisualization,
  getImageInfo,
  computeImageStats,
  searchDatasets,
  PrivateKeySchema,
  DatasetIdSchema,
  VisParamsSchema,
  GeometrySchema,
  ScaleSchema,
  QuerySchema
} from "./earthengineTools";

const handler = createMcpHandler(
  (server) => {
    // Tool to initialize Earth Engine with authentication
    server.tool(
      "earthengine_initialize",
      "Initialize and authenticate with Google Earth Engine using a service account private key",
      { privateKeyJson: PrivateKeySchema },
      async ({ privateKeyJson }) => {
        const result = await initializeEarthEngine(privateKeyJson);
        
        if (result.success) {
          return {
            content: [{ type: "text", text: "Earth Engine initialized successfully!" }],
          };
        } else {
          return {
            content: [{ type: "text", text: `Failed to initialize Earth Engine: ${result.message}` }],
          };
        }
      }
    );

    // Tool to visualize a dataset
    server.tool(
      "earthengine_visualize_dataset",
      "Generate a visualization (map) for an Earth Engine dataset",
      { 
        datasetId: DatasetIdSchema,
        visParams: VisParamsSchema 
      },
      async ({ datasetId, visParams = {} }) => {
        // First try to initialize with the default key if not initialized
        try {
          const result = await getDatasetVisualization(datasetId, visParams);
          
          if ('error' in result) {
            return {
              content: [{ type: "text", text: `Error: ${result.message}` }],
            };
          }
          
          return {
            content: [
              { 
                type: "text", 
                text: `Map visualization for ${datasetId} created successfully.` 
              },
              {
                type: "text",
                text: `Map URL: ${result.url}\nMap ID: ${result.mapId}\nToken: ${result.token}`
              }
            ],
          };
        } catch (error) {
          return {
            content: [
              { 
                type: "text", 
                text: `Error visualizing dataset: ${error instanceof Error ? error.message : String(error)}` 
              }
            ],
          };
        }
      }
    );

    // Tool to get image information
    server.tool(
      "earthengine_get_image_info",
      "Get metadata and information about an Earth Engine image dataset",
      { datasetId: DatasetIdSchema },
      async ({ datasetId }) => {
        try {
          const result = await getImageInfo(datasetId);
          
          if ('error' in result) {
            return {
              content: [{ type: "text", text: `Error: ${result.message}` }],
            };
          }
          
          return {
            content: [
              { 
                type: "text", 
                text: `Information for dataset ${datasetId}:` 
              },
              {
                type: "text",
                text: JSON.stringify(result, null, 2)
              }
            ],
          };
        } catch (error) {
          return {
            content: [
              { 
                type: "text", 
                text: `Error getting image info: ${error instanceof Error ? error.message : String(error)}` 
              }
            ],
          };
        }
      }
    );

    // Tool to compute image statistics
    server.tool(
      "earthengine_compute_stats",
      "Compute statistics for an Earth Engine image in a specified region",
      { 
        datasetId: DatasetIdSchema,
        geometry: GeometrySchema,
        scale: ScaleSchema
      },
      async ({ datasetId, geometry, scale = 1000 }) => {
        try {
          const result = await computeImageStats(datasetId, geometry, scale);
          
          if ('error' in result) {
            return {
              content: [{ type: "text", text: `Error: ${result.message}` }],
            };
          }
          
          return {
            content: [
              { 
                type: "text", 
                text: `Statistics for dataset ${datasetId}:` 
              },
              {
                type: "text",
                text: JSON.stringify(result, null, 2)
              }
            ],
          };
        } catch (error) {
          return {
            content: [
              { 
                type: "text", 
                text: `Error computing statistics: ${error instanceof Error ? error.message : String(error)}` 
              }
            ],
          };
        }
      }
    );

    // Tool to search Earth Engine datasets
    server.tool(
      "earthengine_search_datasets",
      "Search for Earth Engine datasets",
      { query: QuerySchema },
      async ({ query }) => {
        try {
          const result = await searchDatasets(query);
          
          if ('error' in result) {
            return {
              content: [{ type: "text", text: `Error: ${result.message}` }],
            };
          }
          
          return {
            content: [
              { 
                type: "text", 
                text: `Search results for "${query}":` 
              },
              {
                type: "text",
                text: JSON.stringify(result, null, 2)
              }
            ],
          };
        } catch (error) {
          return {
            content: [
              { 
                type: "text", 
                text: `Error searching datasets: ${error instanceof Error ? error.message : String(error)}` 
              }
            ],
          };
        }
      }
    );
  },
  {
    capabilities: {
      tools: {
        earthengine_initialize: {
          description: "Initialize and authenticate with Google Earth Engine using a service account private key",
        },
        earthengine_visualize_dataset: {
          description: "Generate a visualization (map) for an Earth Engine dataset",
        },
        earthengine_get_image_info: {
          description: "Get metadata and information about an Earth Engine image dataset",
        },
        earthengine_compute_stats: {
          description: "Compute statistics for an Earth Engine image in a specified region",
        },
        earthengine_search_datasets: {
          description: "Search for Earth Engine datasets",
        },
      },
    },
  },
  {
    redisUrl: process.env.REDIS_URL,
    basePath: "",
    verboseLogs: true,
    maxDuration: 60,
  }
);

export { handler as GET, handler as POST, handler as DELETE }; 