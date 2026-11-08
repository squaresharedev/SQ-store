"use client";

import dynamic from "next/dynamic";

/** The lab starts from the address bar, which the server never sees, so it renders in the browser only. */
export const LabLoader = dynamic(() => import("./PaymentsLab").then((lab) => lab.PaymentsLab), { ssr: false });
