import { AppError } from './validation.mjs';

// The original object name and cookie names are permanent: existing members keep their profiles.
export const CLASSES = Object.freeze({
  '27-01': {id:'27-01',prefix:'',object:'tether-accountability-v1',passwordKey:'MEMBER_PASSWORD',cookieSuffix:''},
  '27-02': {id:'27-02',prefix:'/class/27-02',object:'tether-accountability-class-27-02-v1',passwordKey:'MEMBER_PASSWORD_27_02',cookieSuffix:'-27-02'},
});
export function classFor(id='27-01') {
  if(!Object.hasOwn(CLASSES,id))throw new AppError('Class not found.',404);
  return CLASSES[id];
}
export function routeClass(path) {
  const match=path.match(/^\/class\/([^/]+)(\/.*)?$/);
  if(!match)return {classroom:CLASSES['27-01'],path};
  const classroom=classFor(match[1]);
  return {classroom,path:match[2]||'/'};
}
