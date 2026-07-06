from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from app.config import settings

app = FastAPI(title="WhatsApp Payment Processor", version="0.1.0")

origins = [o.strip() for o in settings.cors_origins.split(",")]


class CORSHeaderMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            return JSONResponse(
                content="ok",
                status_code=200,
                headers={
                    "Access-Control-Allow-Origin": request.headers.get("origin", "*"),
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Allow-Credentials": "true",
                    "Access-Control-Max-Age": "86400",
                },
            )
        response = await call_next(request)
        origin = request.headers.get("origin", "")
        if origin in origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
        return response


app.add_middleware(CORSHeaderMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers={
            "Access-Control-Allow-Origin": request.headers.get("origin", "*"),
            "Access-Control-Allow-Credentials": "true",
        },
    )


from app.routers import upload, proofs, erp, receipts, whatsapp, accounting, reconciliation

app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(proofs.router, prefix="/api", tags=["proofs"])
app.include_router(erp.router, prefix="/api", tags=["erp"])
app.include_router(receipts.router, prefix="/api", tags=["receipts"])
app.include_router(whatsapp.router, prefix="/api", tags=["whatsapp"])
app.include_router(accounting.router, prefix="/api", tags=["accounting"])
app.include_router(reconciliation.router, prefix="/api", tags=["reconciliation"])


@app.get("/api/whatsapp/test")
def test_whatsapp():
    from app.services.whatsapp_client import whatsapp_client
    result = whatsapp_client.send_message("31611000862", "Test from tolmaierp backend")
    return result


@app.get("/health")
def health():
    return {"status": "ok"}
