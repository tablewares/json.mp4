from llama_index.core import SimpleDirectoryReader, VectorStoreIndex

# 1. Load documents from a directory
documents = SimpleDirectoryReader("/home/tablewares/json.mp4/docs").load_data()

# 2. Create an index out of those documents
index = VectorStoreIndex.from_documents(documents)

# 3. Query your data using an LLM
query_engine = index.as_query_engine()
response = query_engine.query("What are the key takeaways from this repo?")
print(response)