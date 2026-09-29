from fastapi import FastAPI
from .pre_flight.router import router as preflight_router

app = FastAPI(title="ai-insights-service")

app.include_router(preflight_router)


@app.get("/")
def read_root():
    return {"status": "ok", "service": "ai-insights-service"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}

