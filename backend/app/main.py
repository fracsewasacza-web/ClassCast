"""
ClassCast backend. Start it from the classcast-backend folder with:

    uvicorn app.main:app --reload

Then open http://127.0.0.1:8000/docs to see and try every endpoint.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.routers import (admin_change_reports, admin_overview, admin_places, admin_reservations, admin_timetable,
                         admin_users, change_reports, me, reservations, rooms)

app = FastAPI(title="ClassCast API", version="0.2.0",
              description="Lecture hall availability and booking for the University of Cape Coast.")

# Lets the front end (a different address) call this server
app.add_middleware(CORSMiddleware, allow_origins=config.ALLOWED_ORIGINS,
                   allow_methods=["*"], allow_headers=["*"])

# One router file per feature, all under /api
for feature in (me, rooms, reservations, change_reports,
                admin_reservations, admin_change_reports, admin_users, admin_places, admin_timetable, admin_overview):
    app.include_router(feature.router, prefix="/api")


@app.get("/api/health", tags=["Health"])
def health() -> dict:
    """No login needed. Use it to check the server is running."""
    return {"status": "ok"}
