import { chromium } from 'playwright';
import  terminalImage from 'terminal-image';
import { select } from '@inquirer/prompts';
import got from 'got';
import * as dotenv from 'dotenv';
import sharp from 'sharp';
dotenv.config();

type Call = {
    username : string,
    calltime: number,
    date: Date,
    daysAgo: number
};

(async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    page.goto("https://discord.com/app")
    console.log("Please Login to Your Discord Account");
    if (process.env.LOGIN_EMAIL!.trim() != "" && process.env.LOGIN_PASSWORD!.trim() != ""){
        await page.getByRole('textbox', { name: 'Email or Phone Number' }).fill(process.env.LOGIN_EMAIL!);
        await page.getByRole('textbox', { name: 'Password' }).click();
        await page.getByRole('textbox', { name: 'Password' }).fill(process.env.LOGIN_PASSWORD!.trim());
        await page.getByRole('button', { name: 'Log In' }).click();
    }
    await page.waitForURL("https://discord.com/channels/@me");
    console.log("Logged In!");
    page.setDefaultTimeout(120000); 
    const dms = await page.getByRole('link', { name: /message/ }).all();
    const names = await Promise.all(dms.map(async (dm) => (await dm.innerText()).split('\n')[0]));
    //console.log(names);
    const img_srcs = await Promise.all((await page.locator('.wrapper_XpIUHy img').all()).slice(0, names.length).map((img) => img.getAttribute("src")));
    //console.log(img_src);

    const choices = await Promise.all(names.map(
        async (name, index) => {
            const buffer = await got(img_srcs[index]!).buffer();
            const png = await sharp(buffer).png().toBuffer();
            return ({
                name: name, 
                value: dms[index], 
                description: await terminalImage.buffer(png, {
                    width: 20,
                    preferNativeRender: false,
                }),
            });
        }
    ));

    const dm = await select({
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
        
        const curCallElem = await page.getByText(/started a call that lasted /).and(page.locator(':not(div[id^="message-content"] > *)')).all();
        const begin = await page.getByText(/the beginning of/).and(page.locator(':not(div[id^="message-content"] > *)'));
        if (await begin.isVisible()){
            break;
        }
        const processedCurCalls = await Promise.all(curCallElem.map(async (loc)=>{
            const call = await loc.innerText();
            const lines = call.split("\n").map(line => line.trim());
            const callTimeStr = lines[1].replace("started a call that lasted ", "");
            const [valStr, unit] = callTimeStr.split(" ");
            
            const dateStr = lines[4];
            const dateStrLines = dateStr.split(' ').map((str)=> str.replaceAll(',', ''));
            const monthDict : Record<string, number> = {'January': 0, 'February': 1, 'March': 2, 'April': 3, 'May': 4, 'June': 5, July: 6, 'August': 7, 'September': 8, 'October': 9, 'November': 10, 'December': 11};
            const isoDate = new Date(parseInt(dateStrLines[3]), monthDict[dateStrLines[1]], parseInt(dateStrLines[2]));

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
        }));
        processedCurCalls.forEach(item => {
            const key = `${item.username}-${item.date.getTime()}-${item.calltime}`;
            if (item.daysAgo < time){
                calls.set(key, item);
            }
            daysAgo = Math.max(daysAgo, item.daysAgo);
        });
        const scroller = page.locator(".scroller_8AE1Qq");
        await scroller.hover();
        await page.mouse.wheel(0, -200);
        await page.getByRole("article").first().waitFor({state: "visible"});
    }
    let uniqueCalls = [...calls.values()];
    uniqueCalls.sort((a: Call, b : Call)=>b.date.getTime()-a.date.getTime());
    console.log(uniqueCalls);
})();
