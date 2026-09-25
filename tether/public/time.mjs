export const ZONE='America/Chicago';
const partsFormat=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function centralInput(iso) {
  const parts=Object.fromEntries(partsFormat.formatToParts(new Date(iso)).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function centralToUTC(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Choose a valid date and time.');
  const base=Date.parse(value+'Z'), matches=[];
  for (const hours of [5,6]) {
    const candidate=new Date(base+hours*3600000).toISOString();
    if (centralInput(candidate)===value) matches.push(candidate);
  }
  if (matches.length===0) throw new Error('That Central Time does not exist because of daylight saving time. Choose another time.');
  if (matches.length>1) throw new Error('That time occurs twice when daylight saving time ends. Choose a time after 2:00 AM.');
  return matches[0];
}
export function dateTime(iso) {
  return iso?new Intl.DateTimeFormat('en-US',{timeZone:ZONE,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(iso)):'—';
}
