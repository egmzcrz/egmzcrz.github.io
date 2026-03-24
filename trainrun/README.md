# WASM Compilation

```bash
emcc engine.c -O3 -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s EXPORTED_FUNCTIONS="['_malloc', '_free', '_run_simulation']" -s EXPORTED_RUNTIME_METHODS="['ccall', 'cwrap', 'HEAPF64']" -o engine.js
```
