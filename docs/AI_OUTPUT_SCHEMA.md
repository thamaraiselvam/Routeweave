
# AI Output Schema

AI must return JSON following this schema.

{
 "apis":[
  {
   "method":"string",
   "path":"string",
   "summary":"string",
   "flow":["string"],
   "tables":["string"],
   "services":["string"],
   "caches":["string"],
   "queues":["string"]
  }
 ]
}

Rules

- Only JSON
- No explanations
- Must match schema exactly
