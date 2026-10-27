import nodemailer from "nodemailer";
import { createVerificationMailer } from "../mailer.mjs";
import {createEmailLinks} from './email-links.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createDeliveryObservation,deliveryMessageId,SchedulingDeliveryError} from './delivery-diagnostics.mjs';
function schedulingTransport(env, {createTransport=nodemailer.createTransport,verificationMailer=createVerificationMailer}={}) {
  if (env.SCHEDULING_EMAIL_ENABLED !== "true") return null;
  const links=createEmailLinks({baseUrl:env.SCHEDULING_PUBLIC_URL,secret:env.SCHEDULING_EMAIL_LINK_SECRET});
  const verifier = verificationMailer(env);
  if (!verifier.configured) throw new Error("Scheduling email requires valid existing SMTP configuration.");
  const context=new AsyncLocalStorage();
  const logger=Object.fromEntries(['trace','debug','info','warn','error','fatal'].map(level=>[level,(...args)=>context.getStore()?.logger[level](...args)]));
  const transport = createTransport({ host: env.SMTP_HOST || "smtp.gmail.com", port: 587, secure: false, requireTLS: true, ignoreTLS:false, opportunisticTLS:false, auth: { user: env.SMTP_USER, pass: env.SMTP_HOST&&env.SMTP_HOST.trim().toLowerCase()!=='smtp.gmail.com'?(env.SMTP_PASSWORD||'').trim():(env.SMTP_PASSWORD || "").replace(/\s/g, "") }, tls: { minVersion: "TLSv1.2", rejectUnauthorized: true }, logger, transactionLog:true, debug: false,pool:false,maxRequeues:0, connectionTimeout: 15e3, greetingTimeout:15e3,dnsTimeout:15e3,socketTimeout: 25e3, disableFileAccess: true, disableUrlAccess: true });
  return { links, sendCode: (mail) => verifier.sendVerification(mail), async send(mail, controls={}) {
    const observation=createDeliveryObservation(controls);
    return context.run(observation,async()=>{
    try {
      await observation.start();
      const result = await transport.sendMail({ from: env.SMTP_FROM, to: mail.to, subject: mail.subject, text: mail.text, html:mail.html, messageId:deliveryMessageId(mail.jobId), attachments: [{ filename: "talk-booking.ics", content: mail.calendar, contentType: "text/calendar" }], disableFileAccess: true, disableUrlAccess: true });
      const delivery=await observation.finish(result,mail.to);
      if(delivery.outcome!=='CONFIRMED_ACCEPTED')throw new SchedulingDeliveryError(delivery);
      return {accepted:true,smtpCode:delivery.smtpCode,delivery};
    } catch (error) {
      if(!(error instanceof SchedulingDeliveryError))observation.error(error);
      const delivery=error instanceof SchedulingDeliveryError?error.delivery:await observation.flush();
      if(delivery.outcome==='CONFIRMED_ACCEPTED')return {accepted:true,smtpCode:delivery.smtpCode,delivery};
      throw new SchedulingDeliveryError(delivery);
    }
    });
  } };
}
export {
  schedulingTransport
};
