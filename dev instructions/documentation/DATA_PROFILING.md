# Comprehensive Data Profiling Guide

This document explains the architecture, tools, methodology, profiling types, and technical rationale for the **Data Profiling Engine** in the AI Insights Platform.

---

## 1. Executive Overview

**Data Profiling** is the second automated stage of the Data Ingestion pipeline (positioned between **Data Inspection** and **Schema Resolution**). 

While Data Inspection discovers raw database table structures and column names, Data Profiling analyzes the **actual content, quality, distribution, and statistical characteristics** of every column in the dataset. It transforms raw data into structured mathematical and semantic metadata that downstream AI agents (Schema Resolver, Hierarchy Mapper, Feature Architect, and Feature Validator) use to make reliable automated decisions.

```
┌─────────────────┐       ┌──────────────────────┐       ┌───────────────────┐
│ Data Inspection │ ───►  │    Data Profiling    │ ───►  │  Schema Resolver  │
│ (Tables & DDL)  │       │ (Stats, Quality, OK) │       │ (Semantic Mapping)│
└─────────────────┘       └──────────────────────┘       └───────────────────┘
                                     │
                                     ▼
                          ┌──────────────────────┐
                          │ Feature Engineering  │
                          │ (Lags, Transforms)   │
                          └──────────────────────┘
```

---

## 2. Why Data Profiling is Required

Without empirical data profiling, automated machine learning pipelines frequently fail due to bad assumptions about column data types, unseen data quality issues, or improper transformations. Data Profiling solves four critical challenges:

### A. Accurate Semantic Type & Role Inference
Database DDL and file formats (CSV, Excel) often misrepresent column types:
* A numeric column `zip_code` (e.g. `90210`) is stored as an integer, but mathematically it is a **categorical identifier** — calculating mean or variance on zip codes produces nonsense.
* A timestamp column `transaction_date` might be stored as raw string `VARCHAR` (`"2026-08-24"`).
* Profiling determines whether a column is **Categorical**, **Continuous Numerical**, **Temporal/Date**, **Boolean**, or an **Entity Identifier (Key)** based on its unique cardinality, pattern frequency, and distribution.

### B. Intelligent Missingness & Quality Auditing
* Datasets contain subtle missing values disguised as strings (`"N/A"`, `"null"`, `"-"`, `"None"`) or placeholder numbers (`-999`, `99999`, `0`).
* Profiling detects the missingness mechanism (**MCAR** - Missing Completely at Random, **MAR** - Missing at Random, **MNAR** - Missing Not at Random), determining whether downstream feature engineers should impute with median, mode, forward-fill, or create a missingness indicator mask.

### C. Foundation for Automated Feature Engineering
* **Skewness & Kurtosis**: Heavily skewed continuous variables (e.g. income, sales with skewness $> 1.5$) require logarithmic or Box-Cox transformations before model ingestion.
* **Cardinality**: Low-cardinality categories ($< 20$ unique values) receive One-Hot Encoding, while high-cardinality categories receive Target Encoding or Frequency Encoding.
* **Temporal Regularity**: For date columns, profiling detects interval spacing (daily, weekly, monthly) and identifies gaps in time-series sequences.

### D. Data Leakage & Outlier Guardrails
* Flags columns with 100% uniqueness (potential primary keys or IDs that cause target leakage) and 0% variance (constant columns that add zero predictive power).
* Identifies severe outliers using Tukey's Interquartile Range (IQR) and Z-score bounds to prevent model distortion.

---

## 3. Profiling Tools & Execution Engine

Data profiling is executed via an **in-process analytical SQL engine (DuckDB)** combined with **deterministic profiling tools** coordinated by the **LangGraph Data Profiling Agent**.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                           Data Profiling Agent                            │
│                        (Ingestion Layer / LLM)                            │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │ Invokes Tool Operations
                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                            Profiling Tool Suite                           │
│  1. fetchSampleDataTool     2. contentValueProfileTool                    │
│  3. completenessProfileTool 4. statisticalProfileTool                     │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │ High-Performance C++ SQL Pushdown
                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                      DuckDB Analytical Engine                             │
│       (Parquet / DuckDB Columnar Stores in /uploads/duckdb)               │
└───────────────────────────────────────────────────────────────────────────┘
```

### 1. `fetchSampleDataTool`
* **Purpose**: Retrieves deterministic row samples from tables without memory overflow.
* **Sampling Methods**:
  * **Interval Sampling**: Reads deterministic offsets across the dataset (e.g. rows at 0%, 25%, 50%, 75%, 100%) to capture data distribution across the entire temporal span or insertion order.
  * **Stratified Sampling**: Samples proportionally across distinct categories of a column (e.g. balancing geographic regions or customer segments) to ensure minority classes are represented.
  * **Random Sampling**: Bernoulli reservoir sampling for general exploratory reads.

### 2. `contentValueProfileTool`
* **Purpose**: Analyzes the structural and semantic shape of every column.
* **Computations**:
  * Total row count, non-empty count, and blank count.
  * Exact or approximate distinct value count (`APPROX_COUNT_DISTINCT`).
  * Top-10 frequent values with occurrence counts and percentage shares.
  * Regex pattern detection (dates, emails, UUIDs, alphanumeric IDs, phone numbers).
  * Mixed data type detection (e.g. strings mixed into numeric columns).
  * Cardinality categorization: `Unique Identifier`, `High Cardinality Categorical`, `Low Cardinality Categorical`, `Binary/Boolean`, `Continuous Numeric`.

### 3. `completenessProfileTool`
* **Purpose**: Performs in-depth data integrity and null-value audits.
* **Computations**:
  * Exact `NULL` count and blank string (`""`, `"   "`) count.
  * Domain-specific placeholder detection (`"N/A"`, `"NaN"`, `"null"`, `"-999"`, `"9999"`, `"0000"`).
  * Completeness percentage: $\text{Completeness} = \frac{\text{Valid Non-Missing Count}}{\text{Total Rows}} \times 100\%$.
  * Missingness pattern classification (MCAR vs MAR vs MNAR).
  * Actionable remediation recommendation (e.g. "Impute with median", "Drop column ($>80\%$ missing)", "Create missing indicator").

### 4. `statisticalProfileTool`
* **Purpose**: Computes comprehensive mathematical moments and distribution metrics for numeric and date/timestamp columns.
* **Computations (Numeric Columns)**:
  * **Central Tendency**: Mean, Median (50th percentile), Mode.
  * **Dispersion**: Standard Deviation ($\sigma$), Variance ($\sigma^2$), Range ($\text{Max} - \text{Min}$), Interquartile Range ($\text{IQR} = Q_3 - Q_1$).
  * **Shape Metrics**: Skewness (asymmetry), Kurtosis (tail heaviness).
  * **Quantiles & Percentiles**: Min, $Q_1$ (25th), Median (50th), $Q_3$ (75th), 90th, 95th, 99th, Max.
  * **Outlier Analysis**: Lower Bound ($Q_1 - 1.5 \times \text{IQR}$), Upper Bound ($Q_3 + 1.5 \times \text{IQR}$), Outlier Count, Outlier Percentage.
* **Computations (Date/Timestamp Columns)**:
  * Minimum date (earliest record) and Maximum date (latest record).
  * Temporal span (days, months, years).
  * Inferred time-series frequency (Daily, Weekly, Monthly, Irregular).
  * Missing date gaps in the time-series continuum.

---

## 4. The 3-Phase Profiling Process

The agent operates in a stateful, iterative 3-phase workflow to balance analytical depth with computational speed:

```
  Phase 1: Exploratory Ingest & Strategy Identification
  └── Fetch 100-row systematic interval sample
  └── Identify stratifying columns & plan targeted checks
                        │
                        ▼
  Phase 2: Targeted Content & Value Profiling
  └── Execute DuckDB pushdown SQL for contentValueProfile across all columns
  └── Classify types: Numeric, Categorical, Date, Key, Text
                        │
                        ▼
  Phase 3: Conditional Follow-Up Deep-Dives
  ├── If column has missing values  ──► Run completenessProfileTool
  └── If column is Numeric or Date   ──► Run statisticalProfileTool
```

1. **Phase 1 — Exploratory Ingest**:
   * Calls `fetchSampleDataTool` for 100 sample records per table using interval sampling.
   * Discovers structural dependencies and identifies suitable stratification columns (e.g. `carrier_type` or `region`).

2. **Phase 2 — Content Value Profiling**:
   * Runs `contentValueProfileTool` directly in DuckDB without loading bulky JSON arrays into memory.
   * Maps out column shapes, cardinalities, and value distributions.

3. **Phase 3 — Conditional Deep-Dive**:
   * If a column has non-zero missing/placeholder counts, `completenessProfileTool` is triggered.
   * If a column is identified as continuous numeric or temporal, `statisticalProfileTool` is triggered.
   * Columns that are pure IDs or low-cardinality text skip heavy statistical math, minimizing unnecessary latency.

---

## 5. Summary of Profiling Output Schema

The final output generated by the Data Profiling Engine and stored in PostgreSQL/DuckDB contains:

| Section | Key Metrics & Data |
| :--- | :--- |
| **`contentProfile`** | Inferred Data Type, Distinct Count, Total Values, Top 10 Frequent Values, Regex Patterns, Mixed-Type %, Categorical vs Continuous Classification |
| **`completenessProfile`** | Null Count, Blank Count, Placeholder Count, Completeness %, Missing Pattern (MCAR/MAR/MNAR), Recommended Imputation Action |
| **`statisticalProfile`** | Min, Max, Mean, Median, Variance, StdDev, Skewness, Kurtosis, $Q_1$, $Q_3$, IQR, Outlier Count, Date Span, Frequency Spacing |

---

## 6. Downstream Pipeline Consumption

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Data Profiling Metadata                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
       ┌────────────────────────────┼────────────────────────────┐
       ▼                            ▼                            ▼
┌──────────────┐             ┌──────────────┐             ┌──────────────┐
│Schema Resolver│            │Hierarchy Map │             │Feature Engine│
│Maps business │             │Builds filter │             │Generates lags│
│roles & topics│             │trees & DAGs  │             │& encodings   │
└──────────────┘             └──────────────┘             └──────────────┘
```

1. **Schema Resolver**: Uses distinct values and data types to map columns to business topics (e.g. identifying `carrier_cost` as a monetary measure and `carrier_name` as a dimensional entity).
2. **Hierarchy Mapper**: Uses unique counts and foreign-key overlap to discover parent-child relationships (e.g. `Country` $\rightarrow$ `State` $\rightarrow$ `City`).
3. **Feature Architect**: Uses skewness to apply log transforms, uses frequency to construct rolling lag windows, and uses date gaps to insert missing time-series records.
4. **Feature Validator**: Uses baseline distributions to calculate Population Stability Index (PSI) and data drift between train and validation splits.
