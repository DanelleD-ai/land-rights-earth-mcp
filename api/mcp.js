
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

  server.registerTool(
    "search_properties_in_area",
    {
      title: "Find Properties in a Geographic Area",
      description:
        "Find Cape Town cadastral properties intersecting a rectangular geographic area. Coordinates must be WGS84 longitude/latitude. Supports pagination and optional property polygons.",
      inputSchema: {
        west: z.number().min(-180).max(180),
        south: z.number().min(-90).max(90),
        east: z.number().min(-180).max(180),
        north: z.number().min(-90).max(90),
        offset: z.number().int().min(0).max(100000).default(0),
        include_geometry: z.boolean().default(false)
      }
    },
    async ({ west, south, east, north, offset, include_geometry }) => {
      try {
        if (west >= east || south >= north) {
          throw new Error("Invalid area: west must be less than east, and south less than north.");
        }

        if (east - west > 0.02 || north - south > 0.02) {
          throw new Error(
            "Area too large. Use a box no wider or taller than 0.02 degrees. Divide larger areas into smaller boxes."
          );
        }

        const pageSize = 20;

        const params = new URLSearchParams({
          where: "1=1",
          geometry: `${west},${south},${east},${north}`,
          geometryType: "esriGeometryEnvelope",
          inSR: "4326",
          spatialRel: "esriSpatialRelIntersects",
          outFields:
            "OBJECTID,SG26_CODE,PRTY_NMBR,ADR_NO,STR_NAME,OFC_SBRB_NAME,ZONING,LU_LGL_STS_DSCR",
          returnGeometry: String(include_geometry),
          outSR: "4326",
          resultOffset: String(offset),
          resultRecordCount: String(pageSize),
          orderByFields: "OBJECTID ASC",
          f: "json"
        });

        const response = await fetch(
          `${PROPERTY_API}?${params}`,
          { signal: AbortSignal.timeout(20000) }
        );

        if (!response.ok) {
          throw new Error(`City GIS returned HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
          throw new Error(data.error.message || "GIS spatial query failed");
        }

        const features = data.features || [];

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              searched_area: { west, south, east, north },
              coordinate_system: "EPSG:4326",
              spatial_relationship: "intersects",
              count_returned: features.length,
              offset,
              next_offset:
                features.length === pageSize
                  ? offset + features.length
                  : null,
              next_page_may_exist: features.length === pageSize,
              exceeded_transfer_limit:
                Boolean(data.exceededTransferLimit),
              properties: features.map(feature => ({
                attributes: feature.attributes,
                ...(include_geometry
                  ? { geometry: feature.geometry }
                  : {})
              })),
              note:
                "Results cover a rectangular search area, not an exact route corridor. A full page may indicate additional records. Continue pagination until an incomplete or empty page."
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
    "find_properties_along_route",
    {
      title: "Find Properties Along a Route",
      description:
        "Find City of Cape Town cadastral properties intersecting a proposed line route. Accepts WGS84 longitude-latitude coordinate pairs. This identifies potential affected parcels but does not yet calculate crossing lengths.",
      inputSchema: {
        coordinates: z.array(
          z.tuple([
            z.number().min(-180).max(180),
            z.number().min(-90).max(90)
          ])
        ).min(2).max(30),
        offset: z.number().int().min(0).max(100000).default(0),
        include_geometry: z.boolean().default(false)
      }
    },
    async ({ coordinates, offset, include_geometry }) => {
      try {
        const lngs = coordinates.map(p => p[0]);
        const lats = coordinates.map(p => p[1]);

        const width = Math.max(...lngs) - Math.min(...lngs);
        const height = Math.max(...lats) - Math.min(...lats);

        if (width > 0.02 || height > 0.02) {
          throw new Error(
            "Route too large for one request. Divide it into shorter sections, each within a 0.02-degree bounding box."
          );
        }

        const pageSize = 20;

        const line = {
          paths: [coordinates],
          spatialReference: { wkid: 4326 }
        };

        const params = new URLSearchParams({
          f: "json",
          where: "1=1",
          geometry: JSON.stringify(line),
          geometryType: "esriGeometryPolyline",
          inSR: "4326",
          spatialRel: "esriSpatialRelIntersects",
          outFields:
            "OBJECTID,SG26_CODE,PRTY_NMBR,ADR_NO,STR_NAME,OFC_SBRB_NAME,ZONING,LU_LGL_STS_DSCR",
          returnGeometry: String(include_geometry),
          outSR: "4326",
          resultOffset: String(offset),
          resultRecordCount: String(pageSize),
          orderByFields: "OBJECTID ASC"
        });

        const response = await fetch(PROPERTY_API, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: params.toString(),
          signal: AbortSignal.timeout(20000)
        });

        if (!response.ok) {
          throw new Error(`City GIS returned HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
          throw new Error(data.error.message || "Route query failed");
        }

        const features = data.features || [];

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              route: coordinates,
              coordinate_system: "EPSG:4326",
              count_returned: features.length,
              offset,
              next_offset: features.length === pageSize
                ? offset + features.length
                : null,
              exceeded_transfer_limit:
                Boolean(data.exceededTransferLimit),
              properties: features.map(feature => ({
                attributes: feature.attributes,
                ...(include_geometry
                  ? { geometry: feature.geometry }
                  : {})
              })),
              important:
                "Results identify polygons intersecting or touching the route. This is not a verified servitude or construction corridor. Crossing lengths have not been calculated. Continue pagination if a full page is returned."
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
    "measure_route_crossings",
    {
      title: "Measure Property Route Crossings",
      description:
        "Find Cape Town cadastral parcels intersected by a short proposed route and calculate approximate metres of line inside each property. WGS84 coordinates in [longitude, latitude] order. Preliminary GIS measurements only.",
      inputSchema: {
        coordinates: z.array(
          z.tuple([
            z.number().min(-180).max(180),
            z.number().min(-90).max(90)
          ])
        ).min(2).max(30)
      }
    },
    async ({ coordinates }) => {
      try {
        const xs = coordinates.map(p => p[0]);
        const ys = coordinates.map(p => p[1]);

        if (
          Math.max(...xs) - Math.min(...xs) > 0.02 ||
          Math.max(...ys) - Math.min(...ys) > 0.02
        ) {
          throw new Error(
            "Route extent exceeds 0.02 degrees. Split the route into shorter sections."
          );
        }

        // Approximate ground distance between two WGS84 positions.
        function metres(a, b) {
          const rad = Math.PI / 180;
          const dLat = (b[1] - a[1]) * rad;
          const dLon = (b[0] - a[0]) * rad;
          const la1 = a[1] * rad;
          const la2 = b[1] * rad;

          const h =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(la1) * Math.cos(la2) *
            Math.sin(dLon / 2) ** 2;

          return 12742000 * Math.asin(
            Math.min(1, Math.sqrt(h))
          );
        }

        // Even-odd test handles Esri multipart polygons
        // and their internal holes.
        function inside(point, rings) {
          let result = false;
          const [x, y] = point;

          for (const ring of rings) {
            for (
              let i = 0, j = ring.length - 1;
              i < ring.length;
              j = i++
            ) {
              const a = ring[i];
              const b = ring[j];

              if (
                (a[1] > y) !== (b[1] > y) &&
                x < (b[0] - a[0]) *
                  (y - a[1]) / (b[1] - a[1]) + a[0]
              ) {
                result = !result;
              }
            }
          }

          return result;
        }

        // Determine where a line segment crosses a
        // polygon boundary, returning a fraction 0..1.
        function intersection(a, b, c, d) {
          const rx = b[0] - a[0];
          const ry = b[1] - a[1];
          const sx = d[0] - c[0];
          const sy = d[1] - c[1];
          const denominator = rx * sy - ry * sx;

          if (Math.abs(denominator) < 1e-15) {
            return null;
          }

          const qx = c[0] - a[0];
          const qy = c[1] - a[1];

          const t = (qx * sy - qy * sx) / denominator;
          const u = (qx * ry - qy * rx) / denominator;

          return t >= 0 && t <= 1 && u >= 0 && u <= 1
            ? t
            : null;
        }

        function clippedLength(route, rings) {
          let total = 0;

          for (let i = 1; i < route.length; i++) {
            const a = route[i - 1];
            const b = route[i];

            const fractions = [0, 1];

            for (const ring of rings) {
              for (let j = 1; j < ring.length; j++) {
                const t = intersection(
                  a, b, ring[j - 1], ring[j]
                );
                if (t !== null) fractions.push(t);
              }
            }

            fractions.sort((a, b) => a - b);

            const unique = fractions.filter(
              (t, index) =>
                index === 0 ||
                t - fractions[index - 1] > 1e-10
            );

            const length = metres(a, b);

            for (let j = 1; j < unique.length; j++) {
              const start = unique[j - 1];
              const end = unique[j];

              if (end - start < 1e-10) continue;

              const mid = (start + end) / 2;
              const point = [
                a[0] + mid * (b[0] - a[0]),
                a[1] + mid * (b[1] - a[1])
              ];

              if (inside(point, rings)) {
                total += length * (end - start);
              }
            }
          }

          return total;
        }

        const params = new URLSearchParams({
          f: "json",
          where: "1=1",
          geometry: JSON.stringify({
            paths: [coordinates],
            spatialReference: { wkid: 4326 }
          }),
          geometryType: "esriGeometryPolyline",
          inSR: "4326",
          spatialRel: "esriSpatialRelIntersects",
          outFields:
            "OBJECTID,SG26_CODE,PRTY_NMBR,ADR_NO,STR_NAME,OFC_SBRB_NAME,ZONING",
          returnGeometry: "true",
          outSR: "4326",
          resultRecordCount: "20",
          orderByFields: "OBJECTID ASC"
        });

        const features = [];
        let complete = false;

        // Page through the City's results, with a safety cap.
        for (let page = 0; page < 10; page++) {
          params.set(
            "resultOffset",
            String(page * 20)
          );

          const response = await fetch(PROPERTY_API, {
            method: "POST",
            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },
            body: params.toString(),
            signal: AbortSignal.timeout(20000)
          });

          if (!response.ok) {
            throw new Error(
              `City GIS HTTP ${response.status}`
            );
          }

          const data = await response.json();

          if (data.error) {
            throw new Error(
              data.error.message || "GIS query failed"
            );
          }

          const batch = data.features || [];
          features.push(...batch);

          if (
            batch.length === 0 ||
            (batch.length < 20 &&
             !data.exceededTransferLimit)
          ) {
            complete = true;
            break;
          }
        }

        if (!complete) {
          throw new Error(
            "Search limit reached. Split route into smaller sections to avoid missing properties."
          );
        }

        const results = features.map(feature => {
          const rings = feature.geometry?.rings;

          if (!rings || !rings.length) {
            throw new Error(
              "A property has missing geometry; measurements cannot be completed."
            );
          }

          const a = feature.attributes;
          const length = clippedLength(
            coordinates, rings
          );

          return {
            sg26_code: a.SG26_CODE,
            erf: a.PRTY_NMBR,
            address:
              [a.ADR_NO, a.STR_NAME]
                .filter(x => x !== null && x !== "")
                .join(" "),
            suburb: a.OFC_SBRB_NAME,
            zoning: a.ZONING,
            crossing_length_m:
              Math.round(length * 100) / 100,
            geometry_intersects_route: true,
            boundary_touch_or_uncertain:
              length < 0.01
          };
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              coordinate_system: "EPSG:4326",
              route_length_m:
                Math.round(
                  coordinates.slice(1).reduce(
                    (sum, p, i) =>
                      sum + metres(coordinates[i], p),
                    0
                  ) * 100
                ) / 100,
              properties_found: results.length,
              complete,
              measurements: results,
              measurement_method:
                "Segment-boundary clipping with even-odd polygon inclusion and spherical distance approximation.",
              cautions: [
                "Preliminary GIS measurements only.",
                "Collinear property boundary segments require manual review.",
                "Distances are approximate, not survey-grade.",
                "Zero-length intersections may be touches rather than crossings.",
                "No servitude or corridor width is implied.",
                "Property geometries and route accuracy must be independently verified."
              ]
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
    "analyse_route_overlaps",
    {
      title: "Analyse Route and Cadastral Overlaps",
      description:
        "Split a short proposed route into sections by cadastral boundary intersections. Report section lengths and all covering SG26 polygons. Flag ambiguous overlapping coverage, uncovered sections and boundary-following geometry. No legal allocation is made.",
      inputSchema: {
        coordinates: z.array(
          z.tuple([
            z.number().min(-180).max(180),
            z.number().min(-90).max(90)
          ])
        ).min(2).max(30)
      }
    },
    async ({ coordinates }) => {
      try {
        const xs = coordinates.map(p => p[0]);
        const ys = coordinates.map(p => p[1]);

        if (
          Math.max(...xs) - Math.min(...xs) > 0.02 ||
          Math.max(...ys) - Math.min(...ys) > 0.02
        ) {
          throw new Error(
            "Route too large. Split into shorter sections."
          );
        }

        const cross = (a, b) =>
          a[0] * b[1] - a[1] * b[0];

        const subtract = (a, b) =>
          [a[0] - b[0], a[1] - b[1]];

        const pointAt = (a, b, t) => [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t
        ];

        function metres(a, b) {
          const r = Math.PI / 180;
          const dLat = (b[1] - a[1]) * r;
          const dLon = (b[0] - a[0]) * r;

          const h =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(a[1] * r) *
            Math.cos(b[1] * r) *
            Math.sin(dLon / 2) ** 2;

          return 12742000 *
            Math.asin(Math.min(1, Math.sqrt(h)));
        }

        function onEdge(p, a, b) {
          const ab = subtract(b, a);
          const ap = subtract(p, a);
          const length = Math.hypot(...ab);

          if (length === 0) return false;

          return (
            Math.abs(cross(ab, ap)) / length < 1e-10 &&
            ap[0] * ab[0] + ap[1] * ab[1] >= -1e-12 &&
            ap[0] * ab[0] + ap[1] * ab[1] <=
              ab[0] ** 2 + ab[1] ** 2 + 1e-12
          );
        }

        function coverage(p, rings) {
          let inside = false;
          let boundary = false;

          for (const ring of rings) {
            for (let j = 0; j < ring.length - 1; j++) {
              const a = ring[j];
              const b = ring[j + 1];

              if (onEdge(p, a, b)) boundary = true;

              if (
                (a[1] > p[1]) !== (b[1] > p[1]) &&
                p[0] <
                  (b[0] - a[0]) *
                  (p[1] - a[1]) /
                  (b[1] - a[1]) + a[0]
              ) {
                inside = !inside;
              }
            }
          }

          return { inside, boundary };
        }

        function breakpoints(a, b, features) {
          const values = [0, 1];
          const r = subtract(b, a);

          for (const f of features) {
            for (const ring of f.geometry.rings) {
              for (let j = 0; j < ring.length - 1; j++) {
                const c = ring[j];
                const d = ring[j + 1];
                const s = subtract(d, c);
                const q = subtract(c, a);
                const den = cross(r, s);

                if (Math.abs(den) < 1e-15) {
                  // Collinear edges will be detected by
                  // midpoint boundary classification.
                  if (Math.abs(cross(q, r)) < 1e-15) {
                    const rr = r[0] ** 2 + r[1] ** 2;
                    if (rr > 0) {
                      for (const p of [c, d]) {
                        const v = subtract(p, a);
                        values.push(Math.max(0, Math.min(1,
                          (v[0] * r[0] + v[1] * r[1]) / rr
                        )));
                      }
                    }
                  }
                  continue;
                }

                const t = cross(q, s) / den;
                const u = cross(q, r) / den;

                if (
                  t >= 0 && t <= 1 &&
                  u >= 0 && u <= 1
                ) {
                  values.push(t);
                }
              }
            }
          }

          return values.sort((x, y) => x - y)
            .filter((v, i, arr) =>
              i === 0 || v - arr[i - 1] > 1e-10
            );
        }

        const base = new URLSearchParams({
          f: "json",
          where: "1=1",
          geometry: JSON.stringify({
            paths: [coordinates],
            spatialReference: { wkid: 4326 }
          }),
          geometryType: "esriGeometryPolyline",
          inSR: "4326",
          spatialRel: "esriSpatialRelIntersects",
          outFields:
            "OBJECTID,SG26_CODE,PRTY_NMBR,ADR_NO,STR_NAME,ZONING",
          returnGeometry: "true",
          outSR: "4326",
          resultRecordCount: "20",
          orderByFields: "OBJECTID ASC"
        });

        const found = new Map();
        let complete = false;

        for (let page = 0; page < 10; page++) {
          base.set("resultOffset", String(page * 20));

          const response = await fetch(PROPERTY_API, {
            method: "POST",
            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },
            body: base.toString(),
            signal: AbortSignal.timeout(20000)
          });

          if (!response.ok) {
            throw new Error(`GIS HTTP ${response.status}`);
          }

          const data = await response.json();

          if (data.error) {
            throw new Error(data.error.message);
          }

          const batch = data.features || [];

          for (const f of batch) {
            if (!f.geometry?.rings?.length) {
              throw new Error(
                "Missing property geometry. Analysis incomplete."
              );
            }
            found.set(f.attributes.OBJECTID, f);
          }

          if (
            batch.length === 0 ||
            (batch.length < 20 &&
              !data.exceededTransferLimit)
          ) {
            complete = true;
            break;
          }
        }

        if (!complete) {
          throw new Error(
            "GIS pagination safety limit reached. Split the route."
          );
        }

        const features = [...found.values()];
        const sections = [];
        let routeLength = 0;

        for (let i = 1; i < coordinates.length; i++) {
          const a = coordinates[i - 1];
          const b = coordinates[i];
          const legLength = metres(a, b);
          routeLength += legLength;

          const cuts = breakpoints(a, b, features);

          for (let j = 1; j < cuts.length; j++) {
            const t0 = cuts[j - 1];
            const t1 = cuts[j];

            if (t1 - t0 < 1e-10) continue;

            const mid = pointAt(a, b, (t0 + t1) / 2);
            const matched = [];
            let boundary = false;

            for (const f of features) {
              const result = coverage(
                mid, f.geometry.rings
              );

              if (result.boundary) boundary = true;

              if (result.inside || result.boundary) {
                matched.push(f.attributes.SG26_CODE);
              }
            }

            const status = boundary
              ? "boundary_uncertain"
              : matched.length > 1
                ? "overlapping"
                : matched.length === 1
                  ? "single_polygon"
                  : "uncovered";

            sections.push({
              segment: i,
              start: pointAt(a, b, t0),
              end: pointAt(a, b, t1),
              length_m: legLength * (t1 - t0),
              status,
              covering_sg26_codes: matched
            });
          }
        }

        const summary = {
          single_polygon_m: 0,
          overlapping_m: 0,
          uncovered_m: 0,
          boundary_uncertain_m: 0
        };

        for (const section of sections) {
          summary[section.status + "_m"] += section.length_m;
        }

        const round = n => Math.round(n * 100) / 100;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              route_length_m: round(routeLength),
              analysis_complete: complete,
              properties_found: features.length,
              properties: features.map(f => ({
                sg26_code: f.attributes.SG26_CODE,
                erf: f.attributes.PRTY_NMBR,
                address: [
                  f.attributes.ADR_NO,
                  f.attributes.STR_NAME
                ].filter(v => v !== null && v !== "")
                  .join(" "),
                zoning: f.attributes.ZONING
              })),
              summary_m: Object.fromEntries(
                Object.entries(summary).map(
                  ([key, value]) => [key, round(value)]
                )
              ),
              sections: sections.map(s => ({
                ...s,
                length_m: round(s.length_m)
              })),
              warnings: [
                "Overlapping GIS polygons are not allocated to individual legal properties.",
                "Boundary-following sections require review.",
                "Spherical WGS84 distances are approximate.",
                "Only City of Cape Town GIS coverage is queried.",
                "Verify SG diagrams and registered cadastral extents before legal, compensation or servitude decisions."
              ]
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
