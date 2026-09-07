from fastapi import FastAPI

app = FastAPI(title="ai-insights-service")


@app.get("/")
def read_root():
    return {"status": "ok", "service": "ai-insights-service"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}
