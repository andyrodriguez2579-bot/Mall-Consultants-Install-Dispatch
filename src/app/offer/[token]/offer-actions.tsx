"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  ErrorBanner,
  Field,
  InfoBanner,
  SuccessBanner,
  buttonClass,
  inputClass,
} from "@/components/ui";
import {
  type OfferActionState,
  acceptOffer,
  askQuestion,
  passOffer,
} from "./actions";

const EMPTY: OfferActionState = {};

function Pending({ children, tone }: { children: string; tone: "success" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(tone, true)}>
      {pending ? "Working…" : children}
    </button>
  );
}

export function OfferActions({
  token,
  canAct,
  initialState,
  questionAlreadyAsked,
}: {
  token: string;
  canAct: boolean;
  initialState: OfferActionState;
  questionAlreadyAsked: boolean;
}) {
  const [acceptState, acceptAction] = useActionState(acceptOffer, initialState);
  const [passState, passActionFn] = useActionState(passOffer, EMPTY);
  const [questionState, questionAction] = useActionState(askQuestion, EMPTY);
  const [showQuestion, setShowQuestion] = useState(false);

  const state: OfferActionState = passState.result ? passState : acceptState;

  // Terminal outcomes replace the buttons entirely -- leaving a live Accept
  // button under "Job already filled" would invite a pointless second tap.
  if (state.result === "accepted") {
    return (
      <div className="space-y-3">
        <SuccessBanner>
          <span className="font-semibold">This job is yours.</span> We have texted you a
          confirmation with the full address and site contact.
        </SuccessBanner>
        <Link href="/jobs" className={buttonClass("primary", true) + " tap"}>
          View my jobs
        </Link>
      </div>
    );
  }

  if (state.result === "already_filled") {
    return (
      <InfoBanner>
        <span className="font-semibold">Job already filled.</span> Another contractor
        accepted this one first. We will send the next opportunity as soon as it is
        posted.
      </InfoBanner>
    );
  }

  if (state.result === "offer_expired") {
    return (
      <InfoBanner>
        <span className="font-semibold">This offer has expired.</span> The response
        window closed. Contact your dispatcher if you are still available.
      </InfoBanner>
    );
  }

  if (state.result === "not_eligible") {
    return <InfoBanner>{state.message ?? "You are not eligible for this job."}</InfoBanner>;
  }

  return (
    <div className="space-y-3">
      {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}

      {canAct ? (
        <>
          <form action={acceptAction}>
            <input type="hidden" name="token" value={token} />
            <Pending tone="success">Accept this job</Pending>
          </form>

          <p className="text-center text-xs text-slate-500">
            First eligible contractor to accept is assigned the job.
          </p>

          <form action={passActionFn}>
            <input type="hidden" name="token" value={token} />
            <Pending tone="secondary">Pass</Pending>
          </form>
        </>
      ) : null}

      {questionState.questionSent || questionAlreadyAsked ? (
        <SuccessBanner>
          Your question has been sent. This offer stays live while you wait.
        </SuccessBanner>
      ) : showQuestion ? (
        <form action={questionAction} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          {questionState.error ? <ErrorBanner>{questionState.error}</ErrorBanner> : null}
          <input type="hidden" name="token" value={token} />
          <Field label="Ask about this job" hint="Asking does not use up your offer.">
            <textarea
              name="question"
              rows={3}
              required
              className={inputClass}
              placeholder="Is the replacement hardware already on site?"
            />
          </Field>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass("primary")}>
              Send question
            </button>
            <button
              type="button"
              onClick={() => setShowQuestion(false)}
              className={buttonClass("secondary")}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowQuestion(true)}
          className="w-full text-center text-sm font-medium text-blue-700 underline underline-offset-4"
        >
          Ask a question instead
        </button>
      )}
    </div>
  );
}
