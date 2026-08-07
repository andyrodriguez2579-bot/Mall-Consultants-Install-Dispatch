"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ErrorBanner, InfoBanner, SuccessBanner, buttonClass } from "@/components/ui";
import { type WorkState, acceptOfferById, passOfferById } from "../../actions";

const EMPTY: WorkState = {};

function Submit({ children, tone }: { children: string; tone: "success" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(tone, true)}>
      {pending ? "Working…" : children}
    </button>
  );
}

export function InAppOfferActions({
  offerId,
  canAct,
  initialState,
}: {
  offerId: string;
  canAct: boolean;
  initialState: WorkState;
}) {
  const [acceptState, acceptAction] = useActionState(acceptOfferById, initialState);
  const [passState, passAction] = useActionState(passOfferById, EMPTY);

  const state = passState.result ? passState : acceptState;

  if (state.result === "accepted" && state.message !== "You passed on this job.") {
    return (
      <div className="space-y-3">
        <SuccessBanner>
          <span className="font-semibold">This job is yours.</span> Full address and site
          contact are on the job page.
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
        accepted this one first.
      </InfoBanner>
    );
  }

  if (state.result === "offer_expired") {
    return <InfoBanner>This offer has expired.</InfoBanner>;
  }

  if (state.result === "not_eligible") {
    return <InfoBanner>{state.message ?? "You are not eligible for this job."}</InfoBanner>;
  }

  if (!canAct) return null;

  return (
    <div className="space-y-3">
      {state.error ? <ErrorBanner>{state.error}</ErrorBanner> : null}

      <form action={acceptAction}>
        <input type="hidden" name="offer_id" value={offerId} />
        <Submit tone="success">Accept this job</Submit>
      </form>

      <p className="text-center text-xs text-slate-500">
        First eligible contractor to accept is assigned the job.
      </p>

      <form action={passAction}>
        <input type="hidden" name="offer_id" value={offerId} />
        <Submit tone="secondary">Pass</Submit>
      </form>
    </div>
  );
}
