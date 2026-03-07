
# Graph Schema

graph.json format

{
 "nodes":[
  {
   "id":"api_users",
   "type":"api",
   "label":"GET /users",
   "summary":"Fetch user profile"
  },
  {
   "id":"table_users",
   "type":"database",
   "label":"users"
  }
 ],
 "edges":[
  {
   "source":"api_users",
   "target":"table_users",
   "type":"reads"
  }
 ]
}
