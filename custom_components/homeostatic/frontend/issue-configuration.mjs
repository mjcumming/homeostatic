import {escapeHtml as esc, inventoryRows} from "./model.mjs?v=104";
import {sourceCoverageIndex, sourceCoveragePolicies} from "./source-coverage.mjs?v=104";

const button=(action,kind,id,name)=>`<button type="button" class="button" data-definition-action="${action}" data-definition-kind="${kind}" data-definition-id="${esc(id)}">${esc(name)}</button>`;

/** Include policies using a source as evidence, as well as its direct checks. */
export function issuePolicyChoices(card,sources,coverage=[]) {
  const data=card.current.data,index=sourceCoverageIndex(data);
  const canonical=new Map(inventoryRows(data).filter(source=>!source.monitoring_policy).map(source=>[source.node_id,source]));
  const ids=new Set(sources.filter(Boolean).flatMap(source=>sourceCoveragePolicies(canonical.get(source.monitoring_source)||source,index)));
  const saved=(card.configuration?.settings?.monitoring_policies||[]).filter(policy=>policy.enabled!==false&&ids.has(policy.id));
  return [...new Map([...coverage,...saved].map(policy=>[policy.id,{id:policy.id,name:policy.name}])).values()];
}

/** Link saved coverage and notification assignments without reading pending drafts. */
export function issueConfiguration(card,coverage,{unavailable=false}={}) {
  const settings=card.configuration?.settings;
  if(unavailable||!settings)return '<section class="issue-configuration"><p role="status">Policy and notification coverage is unavailable.</p><button type="button" class="button" data-action="retry-issue-configuration">Retry</button></section>';
  const policies=[...new Map(coverage.map(policy=>[policy.id,policy])).values()];
  const definitions=settings.notification_definitions||{},profiles=definitions.profiles||{};
  const saved=new Map((settings.monitoring_policies||[]).map(policy=>[policy.id,policy]));
  const notifications=new Map();
  let incomplete=false;
  for(const policy of policies) {
    const owner=saved.get(policy.id);
    if(!owner){incomplete=true;continue;}
    for(const row of owner.notifications||[]) {
      const profile=row.profile&&profiles[row.profile];
      if(profile) {
        const methods=(profile.methods||[]).map(id=>definitions.methods?.[id]);
        const note=!methods.length?"No delivery method selected":methods.some(method=>!method)?"Delivery method unavailable":methods.some(method=>method.mode==="fixed"&&!method.destinations?.length)?"Delivery method needs destinations":"";
        notifications.set(`profile:${row.profile}`,{action:"open-notification",kind:"profiles",id:row.profile,name:profile.name,note});
      }else {
        const name=row.profile?"Unavailable notification":"Custom notification";
        notifications.set(`policy:${policy.id}:${row.profile||"custom"}`,{action:"open-policy",kind:"policies",id:policy.id,name:`${name} · ${owner.name}`,note:""});
      }
    }
  }
  const policyButtons=policies.map(policy=>button("open-policy","policies",policy.id,saved.get(policy.id)?.name||policy.name)).join("");
  const notificationButtons=[...notifications.values()].map(item=>`<div class="issue-notification">${button(item.action,item.kind,item.id,item.name)}${item.note?`<span class="small">${esc(item.note)}</span>`:""}</div>`).join("");
  const unknown=incomplete?'<p class="small">Some notification assignments are unavailable. Reopen the issue after settings refresh.</p>':"";
  return `<section class="issue-configuration issue-policy-links" aria-label="Policies"><h3>Policies:</h3><div class="actions">${policyButtons||'<span class="small">None currently apply</span>'}</div></section><section class="issue-configuration issue-notification-links" aria-label="Notifications"><h3>Notifications:</h3><div class="actions">${notificationButtons||(!incomplete?'<span class="small">None assigned</span>':"")}</div>${unknown}</section>`;
}
