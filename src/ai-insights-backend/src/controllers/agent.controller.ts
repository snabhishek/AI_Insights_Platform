// import { Request, Response } from "express";
// import { createAgentGraph } from "../agents/graph";
// import { ConnectorService } from "../services/connector.service";
// import { AgentState } from "../agents/state";

// export class AgentController {
//   constructor(private connectorService: ConnectorService) {}

//   public runInspector = async (req: Request, res: Response): Promise<void> => {
//     try {
//       const { connectorIds } = req.body;
//       if (!connectorIds || !Array.isArray(connectorIds)) {
//         res.status(400).json({ error: "connectorIds array is required" });
//         return;
//       }

//       // Fetch the actual connector objects
//       const connectors = [];
//       for (const id of connectorIds) {
//         const connector = await this.connectorService.getById(id);
//         if (connector) {
//           connectors.push(connector);
//         }
//       }

//       const app = createAgentGraph();
//       const initialState: AgentState = {
//         connectorIds,
//         connectors,
//         sourceStructureFiles: [],
//         llmInferredRelationshipsFiles: [],
//         errors: [],
//       };

//       const result = await app.invoke(initialState);
      
//       // Clean up connectors array from result before returning (to not dump sensitive creds)
//       if (result.connectors) {
//         delete result.connectors;
//       }

//       res.status(200).json({ success: true, state: result });
//     } catch (error: any) {
//       console.error("[AgentController] Error running inspector:", error);
//       res.status(500).json({ error: error.message });
//     }
//   };
// }
