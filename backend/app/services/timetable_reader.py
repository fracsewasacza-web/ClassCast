"""
Reads a photo or screenshot of a printed timetable with Claude and turns it into
rows shaped like the CSV upload (course_code, course_title, room, day, start, end,
lecturer). Nothing is saved here: the administrator checks the rows first.

Needs ANTHROPIC_API_KEY in the environment (on Render: the backend's Environment tab).
"""
import anthropic
from pydantic import BaseModel

from app import config

MODEL = "claude-opus-5-5"


class ReadError(Exception):
    """A problem the administrator should see, with the HTTP status to send."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class ReadRow(BaseModel):
    course_code: str
    course_title: str
    room: str
    day: str
    start: str
    end: str
    lecturer: str


class ReadResult(BaseModel):
    rows: list[ReadRow]
    notes: str


PROMPT = """This image is a university lecture timetable from the University of Cape Coast.
List every class meeting in it, one row per meeting. If a course meets on two days, or in two
time slots, give each its own row.

For each row:
- course_code: the course code with a space before the number, e.g. "CSC 301".
- course_title: the course name if the image shows it, otherwise "".
- room: the lecture hall exactly as it is spelled in this list of halls ClassCast knows:
  {rooms}
  If the image writes it differently (e.g. "NLT1" or "N.L.T 1"), use the spelling from the list.
  If the hall is not in the list, copy what the image says.
- day: the full weekday name, e.g. "Monday".
- start and end: 24-hour clock with two-digit hours, e.g. "08:00" and "14:30".
- lecturer: the lecturer's name if shown, otherwise "".

Only list what you can actually read in the image. Do not guess a class that is not there.
If a cell is unreadable, leave that field "" rather than inventing a value.
In notes, say in one or two short sentences anything the administrator should check
(unreadable cells, halls not in the list, rows you were unsure of). Use "" if there is nothing."""


def read(data_b64: str, media_type: str, rooms: list[str]) -> dict:
    """Return {"rows": [...], "notes": "..."} read from the image."""
    if not config.ANTHROPIC_API_KEY:
        raise ReadError(503, "Reading timetable images is not set up yet: the server has no ANTHROPIC_API_KEY.")

    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY, timeout=170, max_retries=1)
    try:
        response = client.beta.messages.parse(
            model=MODEL,
            max_tokens=16000,
            # If the model declines for safety reasons, the API retries on a suitable model itself
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_format=ReadResult,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data_b64}},
                {"type": "text", "text": PROMPT.format(rooms=", ".join(rooms))},
            ]}],
        )
    except anthropic.BadRequestError as e:
        raise ReadError(400, f"Claude could not use that image: {e.message}")
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError):
        raise ReadError(503, "The server's ANTHROPIC_API_KEY was refused. Check it in the Render settings.")
    except anthropic.RateLimitError:
        raise ReadError(429, "Too many images at once. Wait a minute and try again.")
    except anthropic.APIStatusError as e:
        raise ReadError(502, f"Claude is not available right now ({e.status_code}). Try again shortly.")
    except anthropic.APIConnectionError:
        raise ReadError(502, "The server could not reach Claude. Try again shortly.")

    if response.stop_reason == "refusal":
        raise ReadError(422, "Claude declined to read this image. Try a clearer photo of the timetable.")
    if response.stop_reason == "max_tokens":
        raise ReadError(422, "The timetable is too large to read in one go. Photograph it in parts and upload each one.")
    result = response.parsed_output
    if result is None:
        raise ReadError(502, "Claude's answer could not be read. Try again.")
    rows = [r.model_dump() for r in result.rows if any(v.strip() for v in r.model_dump().values())]
    return {"rows": rows, "notes": result.notes.strip()}
