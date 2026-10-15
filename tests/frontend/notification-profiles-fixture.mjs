import {emptyNotificationDefinitions,newMonitoringPolicy} from "../../custom_components/homeostatic/frontend/reusable-editors.mjs";

export function notificationSettings() {
  const definitions=emptyNotificationDefinitions("America/Chicago");
  definitions.methods.phone={name:"Owner phone",mode:"fixed",destinations:["phone:owner"]};
  definitions.profiles={
    immediate:{name:"Immediate",timing:{mode:"immediate"},methods:[]},
    acknowledge:{name:"Immediate with acknowledgment",timing:{mode:"acknowledge",remind_every:1800},methods:[]},
    urgent:{name:"Urgent",timing:{mode:"window",start:"08:00",end:"22:00"},methods:[]},
    morning:{name:"Morning summary",timing:{mode:"report",at:"08:00",weekdays:[0,1,2,3,4,5,6]},methods:[]},
    evening:{name:"Evening summary",timing:{mode:"report",at:"18:00",weekdays:[0,1,2,3,4,5,6]},methods:[]},
    weekly:{name:"Weekly summary",timing:{mode:"report",at:"08:00",weekdays:[6]},methods:[]},
  };
  const policy={...newMonitoringPolicy([],"battery",definitions.profiles),enabled:true};
  return {notification_definitions:definitions,monitoring_policies:[policy],timings:{},notifications:false,consumer:null};
}
