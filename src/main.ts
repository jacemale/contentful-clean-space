import { createClient } from "contentful-management";
import * as inquirer from "inquirer";
import * as ProgressBar from "progress";
import * as yargs from "yargs";
import { Space } from "contentful-management/typings/space";
import { Entry } from "contentful-management/typings/entry";

export async function main() {
    const argv = yargs.env()
        .option("space-id", {
            type: "string",
            describe: "Contentful space id",
            demandOption: true
        }).option("env", {
            type: "string",
            describe: "Contentful environment",
            default: "master",
            demandOption: false
        }).option("accesstoken", {
            type: "string",
            describe: "Contentful access token",
            demandOption: true
        }).option("content-type", {
            type: "string",
            describe: "Content type to be removed",
        }).option("batch-size", {
            type: "number",
            describe: "Number of parallel contentful requests",
            default: 5
        }).option("content-types", {
            type: "boolean",
            describe: "Delete content types as well",
            default: false
        }).option("yes", {
            type: "boolean",
            describe: "Auto-confirm delete prompt",
            alias: "y",
            default: false
        }).option("verbose", {
            type: "boolean",
            alias: "v",
            default: false
        }).option("whitelist", {
            type: "string",
            describe: "File with IDs to ignore",
            alias: "w",
            default: undefined
        }).version(false)
        .parse();
    const accessToken: string = argv["accesstoken"];
    const spaceId: string = argv["space-id"];
    const verbose: boolean = argv["verbose"];
    const batchSize: number = argv["batch-size"];
    const contentType: string | undefined = argv["content-type"];
    const isContentTypes: boolean = argv["content-types"];
    const yes: boolean = argv["yes"];
    const whitelist: string | undefined = argv["whitelist"];

    const env: string = argv["env"] || 'master';

    const contentfulManagementClient = createClient({
        accessToken
    });
    console.log(`Opening Contentful space "${spaceId}"`);
    const contentfulSpace = await contentfulManagementClient.getSpace(spaceId);
    console.log(`Using space "${spaceId}" (${contentfulSpace.name})`);
    let ignored: Array<string> = [];

    if (whitelist) {
        ignored = require('fs').readFileSync(whitelist, 'utf-8').split(/\r?\n/);
    }

    if (!yes) {
        if (!await promptForEntriesConfirmation(spaceId, env))
            return;
    }
    await deleteEntries(contentfulSpace, contentType, batchSize, verbose, env, e => !ignored.some(id => id == e.sys.id));

    if (isContentTypes) {
        if (!yes) {
            if (!await promptForContentTypesConfirmation(spaceId, env))
                return;
        }
        await deleteContentTypes(contentfulSpace, batchSize, verbose, env);
    }
}

async function promptForEntriesConfirmation(spaceId: string, environment: string) {
    const a: any = await inquirer.prompt([{
        type: "confirm",
        name: "yes",
        message: `Do you really want to delete all entries from space ${spaceId}:${environment}?`
    }]);
    return a.yes;
}

async function promptForContentTypesConfirmation(spaceId: string, environment: string) {
    const a: any = await inquirer.prompt([{
        type: "confirm",
        name: "yes",
        message: `Do you really want to delete all content types from space ${spaceId}:${environment}?`
    }]);
    return a.yes;
}

async function deleteEntries(contentfulSpace: Space, contentType: string | undefined, batchSize: number, verbose: boolean, environment: string, filter: (e: Entry) => Boolean) {
    const selectedEnvironment = await contentfulSpace.getEnvironment(environment);
    const entriesMetadata = await selectedEnvironment.getEntries({
        include: 0,
        limit: 0,
        content_type: contentType
    });
    let totalEntries = entriesMetadata.total;
    console.log(`Deleting ${totalEntries} entries`);

    let offset = 0;
    // tslint:disable-next-line:max-line-length
    const entriesProgressBar = new ProgressBar("Deleting entries [:bar], rate: :rate/s, done: :percent, time left: :etas", { total: totalEntries });
    do {
        const entries = await selectedEnvironment.getEntries({
            include: 0,
            skip: offset,
            limit: batchSize,
            content_type: contentType
        });
        totalEntries = entries.total;

        const promises: Array<Promise<void>> = [];
        for (const entry of entries.items.filter(e => filter(e))) {
            const promise = unpublishAndDeleteEntry(entry, entriesProgressBar, verbose);
            promises.push(promise);
        }
        await Promise.all(promises);
        offset += entries.limit;
    } while (totalEntries > batchSize);
}

async function unpublishAndDeleteEntry(entry: Entry, progressBar: ProgressBar, verbose: boolean) {
    try {
        if (entry.isPublished()) {
            if (verbose)
                console.log(`Unpublishing entry "${entry.sys.id}"`);
            await entry.unpublish();
        }
        if (verbose) {
            console.log(`Deleting entry '${entry.sys.id}"`);
        }
        // require('fs').appendFileSync('log.csv', `${entry.fields.programmeNamePcs["en-GB"]}\n`);
        // require('fs').appendFileSync('log-ids.csv', `${entry.sys.id}\n`);
        await entry.delete();
    } catch (e) {
        console.log(e);
        // Continue if something went wrong with Contentful
    } finally {
        progressBar.tick();
    }
}

async function deleteContentTypes(contentfulSpace: any, batchSize: number, verbose: boolean, environment: string) {
    const selectedEnvironment = await contentfulSpace.getEnvironment(environment);
    const contentTypesMetadata = await selectedEnvironment.getContentTypes({
        include: 0,
        limit: 0
    });
    let totalContentTypes = contentTypesMetadata.total;
    console.log(`Deleting ${totalContentTypes} content types`);

    // tslint:disable-next-line:max-line-length
    const contentTypesProgressBar = new ProgressBar("Deleting content types [:bar], rate: :rate/s, done: :percent, time left: :etas", { total: totalContentTypes });
    do {
        const contentTypes = await contentfulSpace.getContentTypes({
            include: 0,
            limit: batchSize
        });
        totalContentTypes = contentTypes.total;

        const promises: Array<Promise<void>> = [];
        for (const contentType of contentTypes.items) {
            const promise = unpublishAndDeleteContentType(contentType, contentTypesProgressBar, verbose, environment);
            promises.push(promise);
        }
        await Promise.all(promises);
    } while (totalContentTypes > batchSize);
}

async function unpublishAndDeleteContentType(contentType: any, progressBar: ProgressBar, verbose: boolean, environment: string) {
    try {
        if (contentType.isPublished()) {
            if (verbose)
                console.log(`Unpublishing content type "${contentType.sys.id}"`);
            await contentType.unpublish();
        }
        if (verbose)
            console.log(`Deleting content type '${contentType.sys.id}"`);
        await contentType.delete();
    } catch (e) {
        console.log(e);
        // Continue if something went wrong with Contentful
    } finally {
        progressBar.tick();
    }
}
