import {parseWorkbook} from './parser.mjs';
self.onmessage=event=>{try{self.postMessage({summary:parseWorkbook(new Uint8Array(event.data))});}catch(error){self.postMessage({error:error instanceof Error?error.message:'Workbook could not be read.'});}};
