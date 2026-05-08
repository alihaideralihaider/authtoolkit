import { runLeadFollowupExecution } from "./execution";
import { sendLeadFollowupMessage } from "./transport";

async function runSimulation() {
  const inputs = [
    {
      label: "Missed call with SMS consent",
      input: {
        leadId: "lead_demo_1",
        contactMethod: "sms" as const,
        contactValue: "+15555555555",
        source: "missed_call" as const,
        customerName: "Ali",
        intent: "order" as const,
        consent: {
          canMessage: true,
          channel: "sms" as const,
          status: "valid" as const,
        },
      },
    },
    {
      label: "No consent",
      input: {
        leadId: "lead_demo_2",
        contactMethod: "sms" as const,
        contactValue: "+15555555555",
        source: "missed_call" as const,
        customerName: "Ali",
        intent: "order" as const,
      },
    },
    {
      label: "Recent contact",
      input: {
        leadId: "lead_demo_3",
        contactMethod: "sms" as const,
        contactValue: "+15555555555",
        source: "missed_call" as const,
        customerName: "Ali",
        intent: "order" as const,
        consent: {
          canMessage: true,
          channel: "sms" as const,
          status: "valid" as const,
        },
        lastContactAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      },
    },
  ];

  for (const scenario of inputs) {
    console.log(`\nScenario: ${scenario.label}`);

    const result = await runLeadFollowupExecution(scenario.input);

    console.log("Execution Result:", result);

    if (
      result.shouldSend &&
      result.decision.channel &&
      result.decision.messageDraft &&
      scenario.input.contactValue
    ) {
      const sendResult = await sendLeadFollowupMessage({
        channel: result.decision.channel,
        to: scenario.input.contactValue,
        message: result.decision.messageDraft,
        delaySeconds: result.decision.delaySeconds,
      });

      console.log("Transport Result:", sendResult);
    }
  }
}

void runSimulation();
