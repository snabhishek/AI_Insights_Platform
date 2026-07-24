export function buildResolveSchemaPrompt(
  connector: any,
  inspection: Record<string, unknown>,
  targetParquetTopics: string[],
  userPrompt?: string,
  dataProfile?: Record<string, unknown>
): string {
  const safeUserRequest = typeof userPrompt === "string" && userPrompt.trim().length > 0 
    ? userPrompt 
    : "No additional request provided.";

  return `## Role
You are an expert AI Data Architect specialized in schema resolution and data ingestion planning for a dynamic Parquet schema generator.

## Objective
Analyze the discovered tables and fields from the data source inspection, understand the business domain and use case, and map every field into an actionable Parquet schema mapping.

## Instructions & Strategy

### Step 1: Identify Business Domain (Mandatory)
- Analyze the inspection metadata, table/column names, data profiling context, connector information, and user request to identify the overarching company/business domain and data use case (e.g., "Retail & E-Commerce Order Management", "Healthcare Patient Records", "Financial Transactions", "Supply Chain Logistics", etc.).
- Set the "domain" field in your JSON response to this identified business domain string.
- Add a mapping entry to "mappings" with:
  - "datasetField": "<Identified Business Domain String>"
  - "targetTopic": "Domain"

### Step 2: Identify Identifier Fields (STRICT FIRST PRIORITY)
- BEFORE mapping any field to other topics, you MUST FIRST identify and fill all **Identifier Fields**.
- Any field that functions as a unique identifier, key, code, index, surrogate key, primary key, foreign key, or reference code MUST be mapped to target topic "Identifier Fields".
- Examples of identifier fields include (but are not limited to):
  - Primary or foreign keys like 'id', 'category_id', 'CategoryID', 'customer_id', 'product_id', 'order_id', 'store_id', 'user_id'
  - Unique codes or numbers like 'sku_code', 'transaction_no', 'account_num', 'uuid', 'guid', 'tracking_number'
- **CRITICAL RULE**: Even if a field name contains descriptive words like "category" (e.g., 'category_id', 'category_code'), if it represents an ID, key, or code, it MUST be mapped to "Identifier Fields", NEVER to "Category" or "Categorical Fields".

### Step 3: Map Remaining Fields to Parquet Topics
After all Identifier Fields are mapped, categorize all remaining fields into the most appropriate static topic:
- **Category** / **Categorical Fields**: Descriptive non-ID categories, types, classifications, genres, statuses (e.g., 'category_name', 'category_description', 'order_status', 'customer_segment', 'product_type'). Never put ID fields here.
- **Temporal Fields**: Dates, timestamps, year, month, time, creation/update dates (e.g., 'created_at', 'order_date', 'timestamp', 'year').
- **Financial Fields**: Monies, prices, costs, revenue, profit, tax, discount, currency, salary, payment amounts.
- **Location Fields**: Address, city, state, country, zip code, postal code, region, latitude, longitude.
- **Customer Fields**: Descriptive customer information like customer name, email, phone, age, gender (excluding customer ID which belongs in "Identifier Fields").
- **Measurement Fields**: Continuous numbers, measurements, metrics, quantities, counts, weights, lengths, scores, percentages, volumes (e.g., 'quantity', 'item_count', 'weight_kg', 'score').
- **Operational Fields**: Workflow statuses, operational flags, system operation states.
- **Event Fields**: Event names, action types, log events, triggers.
- **Inventory Fields**: Stock levels, reorder points, warehouse location names, SKU quantity on hand.
- **Risk Fields**: Risk scores, fraud indicators, risk levels.
- **Quality Fields**: Quality scores, defect rates, inspection results.
- **Maintenance Fields**: Maintenance logs, repair dates, equipment statuses.
- **Resource Fields**: Resource allocation, CPU/memory usage, staff assignment.
- **Feature Engineering Fields**: Derived features, aggregated flags, ML input features.
- **Label Fields**: Target classification labels, ground truth classes for ML.
- **Target / Prediction Fields**: Target columns for prediction models.
- **Forecast Fields**: Forecasted metrics or future predictions.
- **Metadata Fields**: File metadata, audit columns, system ingestion timestamps.
- **External Factors**: Weather data, economic indicators, external trends.

If a field does not fit any existing topic, map it to the closest appropriate topic from the static topics list.

## Static Parquet Topics
${JSON.stringify(targetParquetTopics, null, 2)}

## Required JSON Shape
Return valid JSON ONLY using this exact shape. Do not include markdown formatting blocks (like \`\`\`json) or any conversational text.
{
  "domain": "string",
  "resolvedTables": ["string"],
  "strategy": "string",
  "mappings": [
    {
      "datasetField": "string",
      "targetTopic": "string"
    }
  ],
  "unmappedDatasetFields": ["string"]
}

## Context
### Inspection Context
${JSON.stringify({ connector, inspection }, null, 2)}

${dataProfile ? `### Data Profile Context\n${JSON.stringify(dataProfile, null, 2)}\n` : ""}
### User Request
${safeUserRequest}
`;
}
