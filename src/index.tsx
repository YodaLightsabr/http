import { Color, Icon, Form, ActionPanel, Action, showToast, Detail, useNavigation, getDefaultApplication, open } from "@raycast/api";
import fetch from 'node-fetch';
import { CURLParser } from 'parse-curl-js';
import mime from 'mime-types';
import React, { useEffect } from 'react';
import os from 'os';
import path from 'path';
import fs from 'fs';

async function getAppForFile (extension: string, data: string | Buffer) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'Raycast__HTTPClient__TempFiles'));
  const filepath = path.join(tmpDir, ((performance.now()) + '').split('.').join('_') + 'file.' + extension);
  fs.writeFileSync(filepath, data);
  const app: any = await getDefaultApplication(filepath);
  fs.unlinkSync(filepath);
  app.prettyName = path.basename(app.path);
  app.prettyName = app.prettyName.substring(0, app.prettyName.length - 4);
  app.open = () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'Raycast__HTTPClient__TempFiles_Open'));
    const filepath = path.join(tmpDir, ((performance.now()) + '').split('.').join('_') + 'file.' + extension);
    fs.writeFileSync(filepath, data);
    open(filepath, app.path);
  }
  return app;
}

function generateMarkdownForImage (buffer: Buffer, extension: string) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'Raycast__HTTPClient__TempFiles'));
  const filepath = path.join(tmpDir, ((performance.now()) + '').split('.').join('_') + 'file.' + extension);
  fs.writeFileSync(filepath, buffer);
  return `# Image Data\n\n![](file://${filepath})`;
}

type Values = {
  url: string;
  headers: string;
  method: string | Method;
  body: string;
};

function prettyTime (ms: number) {
  if (ms < 1000) return `${Math.floor(ms)}ms`;
  return `${Math.floor(ms / 1000)}s`;
}

function determineElapsedTime (start: number, end: number) {
  if (end === 0) return Math.round(performance.now() - start);
  return Math.round(end - start);
}

function determineColor (status: number) {
  if (status >= 100 && status < 200) return Color.PrimaryText;
  if (status >= 200 && status < 300) return Color.Green;
  if (status >= 300 && status < 400) return Color.Yellow;
  if (status >= 400 && status < 500) return Color.Red;
  if (status >= 500) return Color.Magenta;
  return Color.Blue;
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
const Methods = ["GET", "POST", "PATCH", "PUT", "DELETE"];

type BodyMethod = "POST" | "PATCH" | "PUT";
const BodyMethods = ["POST", "PATCH", "PUT"];

type ImageExtension = "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp";
const ImageExtensions = ["png", "jpg", "jpeg", "gif", "bmp", "webp"];

export default function BuildRequest () {
  const { push } = useNavigation();

  const [method, setMethod] = React.useState<string | Method>("GET");
  const [headers, setHeaders] = React.useState<string>(JSON.stringify({}, null, 4));
  const [headersObject, setHeadersObject] = React.useState<object>({});
  const [url, setUrl] = React.useState<string>("https://example.com");
  const [curl, setCurl] = React.useState<string>('');
  const [body, setBody] = React.useState<string>('');
  const urlRef = React.useRef<Form.TextField|any>(null);

  function handleSubmit(values: Values) {
    push(<SendRequest url={values.url} body={values.body} method={values.method} headers={headersObject} />);
  }

  function parseCurl (newValue: string) {
    try {
      const cURLParser = new CURLParser(newValue);
      const output = cURLParser.parse();
      console.log(output);
      let { url, headers, method, body: { data } } = output;
      if ((url.startsWith(`'`) && url.endsWith(`'`)) || (url.startsWith('"') && url.endsWith('"'))) url = url.substring(1, url.length - 1);
      setUrl(url);
      setMethod(method);
      if (data !== data) setBody(data);
      else setBody('');
      setHeaders(JSON.stringify(headers, null, 4));
      setHeadersObject(headers);
      urlRef.current.focus();
    } catch (err) {
      setUrl(newValue);
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm icon={Icon.ArrowRight} onSubmit={handleSubmit} title={`Send ${method} request with ${Object.keys(headersObject).length} headers`} />
        </ActionPanel>
      }
      navigationTitle={`Create ${method} Request`}
    >
      <Form.Description text="Send an HTTP request" />
      <Form.TextField id="url" ref={urlRef} storeValue={true} value={url} onChange={parseCurl} title="URL" placeholder="Enter URL or paste cURL command" />
      <Form.Dropdown id="method" storeValue={true} title="Method" value={method} onChange={setMethod} info="The request method to use in this request. Only POST, PATCH, or PUT can include a body.">
        {
          Methods.map(method => 
            <Form.Dropdown.Item key={method} value={method} title={method} />
          )
        } 
      </Form.Dropdown>
      {
        BodyMethods.includes(method) ? 
        <Form.TextArea id="body" storeValue={true} title="Request body" placeholder="{}" value={body} onChange={setBody} />
        : null
      }
      <Form.Separator />
      <Form.Description text="Headers" />
      <Form.TextArea id="headers" storeValue={true} title="Headers" placeholder="{}" value={headers} onChange={newValue => {
        setHeaders(newValue);
        try {
          if (JSON.stringify(headersObject) === JSON.stringify(JSON.parse(newValue))) return;

          setHeadersObject(JSON.parse(newValue));
          setHeaders(JSON.stringify(JSON.parse(newValue), null, 4));
        } catch (err) {}
      }} info="The headers for this request as JSON" />
      <Form.Separator />
    </Form>
  );
}

export function SendRequest ({ method, url, headers, body }: { method: Method | string, url: string, headers: object, body: string }) {
  const { pop, push } = useNavigation();
  const [loading, setLoading] = React.useState<boolean>(true);
  const [response, setResponse] = React.useState<object|any>({ headers: {} });
  const [didSendRequest, setDidSendRequest] = React.useState<boolean>(false);
  const [startTime, setStartTime] = React.useState<number>(0);
  const [endTime, setEndTime] = React.useState<number>(0);
  const [elapsedTime, setElapsedTime] = React.useState<number>(0);
  const [renderTime, setRenderTime] = React.useState<number>(0);
  const [abortController, setAbortController] = React.useState<AbortController>(new AbortController());
  const [application, setApplication] = React.useState<object | any>({});

  useEffect(() => {
    if (!endTime) setTimeout(() => setRenderTime(renderTime + 1), 50);
    setElapsedTime(determineElapsedTime(startTime, endTime));
  }, [startTime, renderTime]);

  async function makeRequest () {
    const start = performance.now();
    setStartTime(start);
    const response = await fetch(url, {
      method,
      headers: JSON.parse(JSON.stringify(headers)),
      body,
      signal: abortController.signal
    });
    const end = performance.now();
    setEndTime(end);
    const time = end - start;
    const { status } = response;
    let responseHeaders: object | any = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    const buffer = await response.buffer();
    const text = buffer.toString('utf-8');
    let isJson: boolean = false;
    try {
      JSON.parse(text);
      isJson = true;
    } catch (err) {}

    
    let isText: boolean = mime.charset(response.headers.get('content-type') + '') ? true : false;
    let extension = mime.extension(response.headers.get('content-type') + '') || 'txt';
    
    return {
      time, status, text, isJson, isText, raw: buffer, isImage: ImageExtensions.includes(extension), getHeader: response.headers.get, headers: responseHeaders, extension
    };
  }

  React.useEffect(() => {
    setDidSendRequest(true);

    let isMounted: boolean = true;

    makeRequest().then(data => {
      if (!isMounted) return;
      setResponse(data);
      setLoading(false);
      getAppForFile(data.extension || 'txt', data.text).then(setApplication);
    }).catch(err => {
      if (err && err.name.includes('AbortError')) return;
      throw err;
    });

    return () => { isMounted = false }; 
  }, []);

  return (
    <Detail navigationTitle={`${method} Request`} isLoading={loading} markdown={
      response.isJson ?
      '```json\n' + JSON.stringify(JSON.parse(response.text), null, 4) + '\n```'
      : (response.isText ? response.text : (
        response.isImage ? generateMarkdownForImage(response.raw, response.extension) : `Unable to decode binary file with extension \`${response.extension || 'Loading...'}\`. You could try opening it in ${application ? '**' + application.prettyName + '**' : 'a supported application'}.`
      ))
    } actions={
      <ActionPanel>
        {response.status ?
          <Action title="Edit Request" onAction={pop} icon={Icon.Pencil} />
        : 
          <Action title="Kill Request" onAction={() => {
            try {
              abortController.abort();
            } catch (err) {}
            setResponse({
              text: `# Request Aborted

This request was killed by the client.`,
              status: "Aborted",
              time: elapsedTime,
              isJson: false,
              headers: {},
              extension: ''
            });
            setEndTime(startTime + elapsedTime);
            setLoading(false);
          }} icon={Icon.XmarkCircle} />
        }
        {application.prettyName ?
          <Action title={`Open in ${application.prettyName}`} onAction={() => {
            application.open();
          }} icon={Icon.Upload} />
        : null}
        {response.status === "Aborted" ?
          <Action title="Retry Request" onAction={() => {
            pop();
            setTimeout(() => {
            push(<SendRequest method={method} url={url} headers={headers} body={body} />);
            }, 1);
          }} icon={Icon.TwoArrowsClockwise} />
        : null}
        <Action.OpenInBrowser title="Open URL in Browser" url={url} shortcut={{ modifiers: ["cmd"], key: "o" }} />
      </ActionPanel>
    } metadata={
      <Detail.Metadata>
        <Detail.Metadata.Link title="URL" target={url} text={url} />
        <Detail.Metadata.Label title="Time" text={prettyTime(determineElapsedTime(startTime, endTime))} />
        {response.status > 100 ?
          <Detail.Metadata.TagList title="Status">
            <Detail.Metadata.TagList.Item text={response.status + ''} color={determineColor(response.status)} />
          </Detail.Metadata.TagList>
        : (
          response.status === "Aborted" ?
            <Detail.Metadata.TagList title="Status">
              <Detail.Metadata.TagList.Item text={"Aborted"} color={Color.Red} />
            </Detail.Metadata.TagList>
          : null
        )}
        {response.extension ?
          <Detail.Metadata.Label title="File Extension" text={`.${response.extension}`} />
        : null}
        <Detail.Metadata.Separator />
        <Detail.Metadata.Label title="Method" text={method} />
        <Detail.Metadata.Label title="Headers" text={Object.keys(headers).length + ''} />
      </Detail.Metadata>
    } />
  );
}