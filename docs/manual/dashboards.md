# Add Homeostatic to a dashboard

[Homeostatic manual](../guide.md)

The sidebar panel is available after installation. Add a dashboard or card when you want Homeostatic alongside other Home Assistant views. Its cards require an administrator account too.

## Add the ready-made dashboard

1. Open **Settings → Dashboards → Add dashboard**.
2. Choose **Homeostatic** from the available dashboard types.
3. Give the dashboard a title and choose its sidebar placement. Create it with administrator-only access.
4. Open it and check the five views: **Open issues**, **Monitoring**, **Policies**, **Notifications** and **History**.

Home Assistant's [dashboard instructions](https://www.home-assistant.io/dashboards/dashboards/#creating-a-new-dashboard) explain the surrounding dashboard controls. An existing Homeostatic dashboard retains the views it was created with; updating the integration does not rewrite your dashboard configuration.

## Add one card

Open a dashboard you can edit, add a manual card and use:

```yaml
type: custom:homeostatic-card
view: issues
navigation: false
```

This opens **Open issues** without page tabs. If a link takes you to another Homeostatic page inside the card, its return control takes you back to the configured view. Set `navigation: true` to show the tabs.

| Card `view` value | Visible page |
| --- | --- |
| `issues` | Open issues |
| `sources` | Monitoring |
| `policies` | Policies |
| `notifications` | Notifications |
| `history` | History |
| `settings` | Settings |

The configuration value `sources` is used for the page labelled Monitoring. Preserve that value in YAML.

If the card cannot load or looks older than the sidebar panel, follow [Old screens after an upgrade](../troubleshooting.md#old-screens-after-an-upgrade).
