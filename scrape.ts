import { chromium, Locator } from 'playwright';
import  terminalImage from 'terminal-image';
import { number, select } from '@inquirer/prompts';
import got from 'got';
import * as dotenv from 'dotenv';
import sharp from 'sharp';
dotenv.config({ quiet: true });
import { styleText } from 'node:util';

type Call = {
    username : string,
    calltime: number,
    date: Date,
    daysAgo: number
};

function formatTime(minutes : number) : string {
    return `${Math.floor(minutes/1440)}d, ${Math.floor((minutes%1440)/60)}h, ${minutes%60}m`;
}

function getISOWeekNumber(date : Date) : string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return String(weekNo);
}


(async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    page.goto("https://discord.com/app")
    console.log("Please Login to Your Discord Account");
    if (process.env.LOGIN_EMAIL?.trim() && process.env.LOGIN_PASSWORD?.trim()){
        await page.getByRole('textbox', { name: 'Email or Phone Number' }).fill(process.env.LOGIN_EMAIL!);
        await page.getByRole('textbox', { name: 'Password' }).click();
        await page.getByRole('textbox', { name: 'Password' }).fill(process.env.LOGIN_PASSWORD!.trim());
        await page.getByRole('button', { name: 'Log In' }).click();
    }
    await page.waitForURL("https://discord.com/channels/@me");
    console.log("Logged In!");
    page.setDefaultTimeout(30000); 
    const dms = await page.getByRole('link', { name: /message/ }).all();
    const names = await Promise.all(dms.map(async (dm) => (await dm.innerText()).split('\n')[0]));
    //console.log(names);
    const img_srcs = await Promise.all((await page.locator('.wrapper_XpIUHy img:not(.avatarDecoration_XpIUHy)').all()).slice(0, names.length).map((img) => img.getAttribute("src")));
    //console.log(img_src);
    for (const [index, dm] of dms.entries()) {
        const hasImage = await dm.locator('.wrapper_XpIUHy img').count() > 0;
        if (!hasImage) {
            img_srcs.splice(
                index,
                0,
                "https://upload.wikimedia.org/wikipedia/commons/c/cd/Portrait_Placeholder_Square.png"
            );
        }
    }

    const choices = await Promise.all(names.map(
        async (name, index) => {
            const buffer = await got(img_srcs[index]!).buffer();
            const png = await sharp(buffer).png().toBuffer();
            return ({
                name: name, 
                value: [dms[index], index] as const, 
                description: await terminalImage.buffer(png, {
                    width: 20,
                    preferNativeRender: false,
                }),
            });
        }
    ));
    const [dm, idx] = await select({
    message: "Which DM do you want to analyze?",
    choices: choices
    });
    const time = await select({
    message: "How far back do you want statistics for?",
    choices: [
        {name: "All time", value: 10000},
        {name: "1 year", value: 365},
        {name: "6 months", value: 180},
        {name: "1 month", value: 30},
        {name: "1 week", value: 7},
        {name: "1 day", value: 1},
    ]
    });
    //console.log(dm, time);
    dm.click();
    await page.waitForURL("https://discord.com/channels/@me/*");
    await page.getByRole("article").first().waitFor({state: "visible"});
    const today = new Date();
    var daysAgo = 0;

    let calls = new Map<string, Call>();
    while (daysAgo < time){
        
        const curCallElem = await page.getByText(/started a call that lasted /)
            .and(page.locator(':not(div[id^="message-content"] > *)'))
            .and(page.locator(':not([id^="message-accessories"] *)'))
            .allInnerTexts();
        const begin = page.getByText(/the beginning of/)
            .and(page.locator(':not(div[id^="message-content"] *)'))
            .and(page.locator(':not([id^="message-accessories"] *)'));
        if (await begin.isVisible()){
            //console.log(await begin.innerText());
            break;
        }
        const processedCurCalls = curCallElem.map((call)=>{
            call = call
                .replace(/\s+(?=started a call that lasted )/, '\n')
                .replace(/\s*—\s*/, '\n—\n')
                .replace(/(\d{1,2}:\d{2}\s*[AP]M)\s*/, '$1\n');
            const lines = call.split("\n").map(line => line.trim()).filter(Boolean);
            if(lines[1] === undefined){
                console.error("Extracted text does not match expected format: " + call);
            }
            const callTimeStr = lines[1].replace("started a call that lasted ", "");
            const [valStr, unit] = callTimeStr.split(" ");
            
            const dateStr = lines[4];
            const dateStrLines = dateStr.split(' ').map((str)=> str.replaceAll(',', ''));
            const monthDict : Record<string, number> = {'January': 0, 'February': 1, 'March': 2, 'April': 3, 'May': 4, 'June': 5, July: 6, 'August': 7, 'September': 8, 'October': 9, 'November': 10, 'December': 11};
            const timeStr = dateStrLines[5];
            const [hStr, mStr] = timeStr.split(":");
            const period = dateStrLines[6];
            const hours = (parseInt(hStr) % 12) + (period == "PM" ? 12 : 0);
            const isoDate = new Date(parseInt(dateStrLines[3]), monthDict[dateStrLines[1]], parseInt(dateStrLines[2]), hours, parseInt(mStr));

            let callTime;
            
            if (unit.includes("hour")){
                if (valStr.includes('a')){
                    callTime = 60;
                }
                else{
                    callTime = parseInt(valStr)*60;  
                }  
            }
            else if(unit.includes("second")){
                callTime = 0;
            }
            else{
                if (valStr.includes('a')){
                    callTime = 1;
                }
                else{
                    callTime = parseInt(valStr);
                }
            }
            return {
                username: lines[0],
                calltime: callTime,
                date: isoDate,
                daysAgo: Math.floor(Math.abs(today.getTime() - isoDate.getTime()) / (1000 * 60 * 60 * 24))
            }
        });
        processedCurCalls.forEach(item => {
            const key = `${item.username}-${item.date.getTime()}-${item.calltime}`;
            if (item.daysAgo < time){
                calls.set(key, item);
            }
            daysAgo = Math.max(daysAgo, item.daysAgo);
        });
        const scroller = page.locator(".scroller_8AE1Qq");
        await scroller.hover();
        await page.mouse.wheel(0, -400);
    }
    let uniqueCalls = [...calls.values()];
    uniqueCalls.sort((a: Call, b : Call)=>b.date.getTime()-a.date.getTime());
    //console.log(uniqueCalls);
    let sum = 0, dayCall = 0, weekCallMins = 0, monthCallMins = 0, sixMonthCallMins = 0, yearCallMins = 0; // Accumulated Call Time Stats
    const calltimePerDay : Map<string, number> = new Map(), calltimePerWeek : Map<string, number> = new Map(); // Most call time stats
    const callsStartedBy : Map<string, number> = new Map();
    uniqueCalls.forEach((item)=>{
        callsStartedBy.set(item.username, (callsStartedBy.get(item.username) ?? 0) + 1);
        const dayKey = String(item.date.getFullYear())+String(item.date.getMonth())+String(item.date.getDate());
        const weekKey = String(item.date.getUTCFullYear())+getISOWeekNumber(item.date);
        calltimePerDay.set(dayKey, (calltimePerDay.get(dayKey) ?? 0) + item.calltime);
        calltimePerWeek.set(weekKey, (calltimePerWeek.get(weekKey) ?? 0) + item.calltime);

        if (item.daysAgo < 1){  
            dayCall += item.calltime;
        }
        if (item.daysAgo < 7){
            weekCallMins += item.calltime;
        }
        if (item.daysAgo < 30){
            monthCallMins += item.calltime;
        }
        if (item.daysAgo < 180){
            sixMonthCallMins += item.calltime;
        }
        if (item.daysAgo < 365){
            yearCallMins += item.calltime;
        }
        sum += item.calltime;
    });
    
    console.log(styleText('green', `Your VC Stats with ${names[idx]}`))
    let output_lines : String[] = [];
    if (time >= 7){
        if (time >= 30){
            if (time >= 180){
                if (time == 10000){
                    output_lines.push(styleText("yellow","Total accumulated call time: ") + formatTime(sum));
                }
                if (time >= 365){
                    output_lines.push(styleText("yellow","Total call time in last 365d: ") + formatTime(yearCallMins));
                }
                output_lines.push(styleText("yellow","Total call time in last 180d: ") + formatTime(sixMonthCallMins));
            }
            output_lines.push(styleText("yellow","Total call time in last 30d: ") + formatTime(monthCallMins));
        }
        output_lines.push(styleText("yellow","Total call time in last 7d: ") + formatTime(weekCallMins));
    }
    output_lines.push(styleText("yellow","Total call time in last 24h: ") + formatTime(dayCall));
    output_lines.push(styleText("yellow","Most call time in a day: ") + formatTime((calltimePerDay.size > 0 
        ? Math.max(...calltimePerDay.values())
        : 0)));

    if (time>=7){
        output_lines.push(styleText("yellow","Most call time in a week: ") + formatTime((calltimePerWeek.size > 0 
        ? Math.max(...calltimePerWeek.values())
        : 0)));
    }
    output_lines.push(styleText("yellow","Most calls started by: ") + (callsStartedBy.size > 0 
        ? [...callsStartedBy.entries()].reduce((max, entry) => entry[1] > max[1] ? entry : max)[0]
        : "N/A"));

    const buffer = await got(img_srcs[idx]!).buffer();
    const png = await sharp(buffer).png().toBuffer();
    const pfp = await terminalImage.buffer(png, {height: output_lines.length, preferNativeRender: false});
    const pfp_lines = pfp.split("\n");
    for (const [index, pfp_line] of pfp_lines.entries()){
        console.log(pfp_line + "     " + output_lines[index]);
    }
    await browser.close();
})();
