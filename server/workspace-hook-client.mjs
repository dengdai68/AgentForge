// Native command Hook: consume stdin without storing tool input, then notify the
// invocation-owned service. Registration failure must not alter the tool result.
import http from 'node:http';
process.stdin.resume();
const request=http.request({socketPath:process.argv[2],path:'/register',method:'POST'},response=>{response.resume();response.on('end',()=>process.stdin.destroy());});
request.setTimeout(30000,()=>request.destroy());
request.on('error',()=>process.stdin.destroy());
request.end();
