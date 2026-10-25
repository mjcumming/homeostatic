# Automation-defined alerts

Home Assistant automations can report continuing problems to Homeostatic. The automation owns the condition, notification text and reporting preference. Homeostatic keeps the issue open, handles acknowledgment and reminders according to its saved notification configuration, and records recovery when the automation reports that the condition cleared.

<a id="before-you-start"></a>

The supplied [Homeostatic alert blueprint](../blueprints/automation/homeostatic/alert.yaml) registers a problem from its owning automation without a separate Homeostatic declaration. It reevaluates on required-entity changes, Home Assistant startup, each minute and any additional triggers you configure. List every entity needed by the condition or message as required evidence. Missing or invalid evidence becomes unknown and cannot clear an existing problem.

Edit the condition and message in the owning Home Assistant automation. Homeostatic's Monitoring page links back to it. Repeated active reports keep the same issue; a new active report after recovery starts a new occurrence. Acknowledgment records awareness and changes reminders according to the saved notification; evidence determines recovery.

The blueprint's Reporting preference choices belong to the existing alert reporting configuration. They are separate from the named notifications selected by equipment monitoring policies. Saved choices continue to work, and the effective timing and destinations depend on the installation's notification configuration. The [reporting reference](reference.md#reporting-choices) describes these paths and the limits of the returned reporting status. New alert-configuration questions are tracked in the [roadmap](roadmap.md#verification-questions).

For the complete action schemas and blueprint inputs, use the [automation alert reference](reference.md#automation-alert-interfaces).
