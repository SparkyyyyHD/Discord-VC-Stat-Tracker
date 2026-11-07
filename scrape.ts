import { chromium } from 'playwright';
import  terminalImage from 'terminal-image';
import { select } from '@inquirer/prompts';
import got from 'got';
import * as dotenv from 'dotenv';
import sharp from 'sharp';
dotenv.config();

(async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    page.goto("https://discord.com/app")
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
                value: name, 
                description: await terminalImage.buffer(png, {
                    width: 20,
                    preferNativeRender: false,
                }),
            });
        }
    ));

    const choice = await select({
    message: "Which DM do you want to analyze?",
    choices: choices
    });
    
    console.log(choice);

})();