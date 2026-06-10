import nodemailer from 'nodemailer';
import EMAIL_CONFIG from "../../config/email.config";
import GMT_CONFIG from "../../config/gmt.config";
import {generateEmailTemplate} from "./email.template";


export function sendEmailExportIsFinished(emailTo: string, jobId: number): Promise<boolean>{
    return new Promise((resolve, reject)=>{
        let transporter = nodemailer.createTransport(EMAIL_CONFIG.transportOptions);
        let message = {
             from: EMAIL_CONFIG.from,
             to: emailTo,
             subject: "Data export is finished",
             html: generateEmailTemplate('Data export is finished',
                 `Your data export is available <a href="${GMT_CONFIG.pwaUrl}/routine-immunization/download/${jobId}" target="_blank">here</a>.`),
        }
        transporter.sendMail(message, (err, info) =>
        {
            if (err) {
                console.log(err, 'Error while sending email');
                reject(err);
            } else {
                console.log(info.response, 'Data export email sent');
                resolve(true);
            }
        });
    });
}


export function sendEmailDataCheckFailed( ): Promise<boolean> {
    return new Promise((resolve, reject)=>{
        let transporter = nodemailer.createTransport(EMAIL_CONFIG.transportOptions);
        let message = {
             from: EMAIL_CONFIG.from,
             to: EMAIL_CONFIG.admin,
             subject: "Data inconsistency detected",
             html: generateEmailTemplate('Data Inconsistency Found !',
                 `Environment [${process.env.ENV_NAME}].  Check the bull queue logs, master.logs table, and importer logs for more details.`),
        }
        transporter.sendMail(message, (err, info) =>
        {
            if (err) {
                console.log(err, 'Error while sending email');
                reject(err);
            } else {
                console.log(info.response, 'Data inconsistency email sent');
                resolve(true);
            }
        });
    });
}
